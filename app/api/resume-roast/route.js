import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { getAccountById } from "@/lib/identity/service";
import { checkTieredRateLimit, RateLimitError } from "@/lib/identity/rate-limit";
import { roastResume, AiUnavailableError } from "@/lib/ai";
import { extractResumeText } from "@/lib/resume-parse";
import { effectiveTier } from "@/lib/tiers";

// Accepts either a multipart upload (`resume` file — PDF or .txt) or a
// JSON body with pasted `text`, extracts the resume content, and sends it
// to the AI roast prompt.
export async function POST(request) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });

  const account = await getAccountById(accountId);

  // OUT has no Resume Roast; OUT+ gets 3/day and OUT PRO 10/day — see
  // lib/identity/rate-limit.js's TIERED_DAILY_LIMITS (the only place the
  // numbers live; the UI deliberately shows no numbers).
  try {
    const tier = effectiveTier(account);
    if (tier === "basic") {
      return NextResponse.json({ error: "Resume Roast AI is part of OUT+ and OUT PRO. Upgrade to use it.", code: "PLAN_REQUIRED" }, { status: 403 });
    }
    await checkTieredRateLimit(accountId, "resume_roast", tier);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return NextResponse.json({ error: e.message, code: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": String(Math.ceil(e.retryAfterMs / 1000)) } });
    }
    throw e;
  }

  const contentType = request.headers.get("content-type") || "";
  let text;

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("resume");
      if (!file || typeof file === "string") {
        return NextResponse.json({ error: "No file received." }, { status: 400 });
      }
      text = await extractResumeText(file);
    } else {
      const body = await request.json().catch(() => null);
      text = body?.text?.trim();
    }
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  if (!text || text.trim().length < 20) {
    return NextResponse.json({ error: "That doesn't look like enough resume text to roast." }, { status: 400 });
  }

  try {
    const result = await roastResume(text);
    return NextResponse.json({ ...result, configured: true });
  } catch (e) {
    if (e instanceof AiUnavailableError) return NextResponse.json({ error: e.message }, { status: 503 });
    throw e;
  }
}
