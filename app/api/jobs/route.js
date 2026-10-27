import { NextResponse } from "next/server";
import { getJobs, createJob } from "@/lib/content/service";
import { getCurrentAccountId } from "@/lib/session";
import { issueContentToken, verifyContentToken } from "@/lib/identity/service";
import { checkRateLimit, RateLimitError } from "@/lib/identity/rate-limit";

const VALID_MODES = new Set(["real", "alias", "anon"]);

export async function GET() {
  return NextResponse.json(await getJobs());
}

export async function POST(request) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });

  try {
    await checkRateLimit(accountId, "post");
  } catch (e) {
    if (e instanceof RateLimitError) {
      return NextResponse.json({ error: e.message }, { status: 429, headers: { "Retry-After": String(Math.ceil(e.retryAfterMs / 1000)) } });
    }
    throw e;
  }

  const body = await request.json().catch(() => null);
  const title = body?.title?.trim();
  const companyName = body?.companyName?.trim();
  if (!title || !companyName) return NextResponse.json({ error: "Job title and company name are required." }, { status: 400 });
  const mode = VALID_MODES.has(body?.mode) ? body.mode : "alias";

  const { token } = await issueContentToken(accountId, mode);
  const identity = await verifyContentToken(token);

  const job = await createJob({
    title, companyName,
    salaryMin: body?.salaryMin ? Number(body.salaryMin) : null,
    salaryMax: body?.salaryMax ? Number(body.salaryMax) : null,
    lastPersonQuitReason: body?.lastPersonQuitReason?.trim() || null,
    anonymousId: identity.anonymousId, authorDisplay: identity.displayLabel,
  });
  return NextResponse.json(job, { status: 201 });
}
