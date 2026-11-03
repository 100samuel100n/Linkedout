import { NextResponse } from "next/server";
import { translateTitle, isAiConfigured, AiUnavailableError } from "@/lib/ai";
import { getCurrentAccountId } from "@/lib/session";
import { getAccountById } from "@/lib/identity/service";
import { checkTieredRateLimit, RateLimitError } from "@/lib/identity/rate-limit";

const VALID_DIRECTIONS = new Set(["real-to-hype", "hype-to-real"]);

export async function GET() {
  return NextResponse.json({ configured: isAiConfigured() });
}

export async function POST(request) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });

  const account = await getAccountById(accountId);

  // Basic/Plus/Pro get 1/3/30 uses per day respectively — see
  // lib/identity/rate-limit.js's TIERED_DAILY_LIMITS.
  try {
    await checkTieredRateLimit(accountId, "translate", account?.premiumTier || "basic");
  } catch (e) {
    if (e instanceof RateLimitError) {
      return NextResponse.json({ error: e.message, code: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": String(Math.ceil(e.retryAfterMs / 1000)) } });
    }
    throw e;
  }

  const body = await request.json().catch(() => null);
  const input = body?.input?.trim();
  const direction = body?.direction;
  if (!input) return NextResponse.json({ error: "Enter a title or description first." }, { status: 400 });
  if (!VALID_DIRECTIONS.has(direction)) return NextResponse.json({ error: "Invalid direction." }, { status: 400 });
  if (input.length > 300) return NextResponse.json({ error: "Keep it under 300 characters." }, { status: 400 });

  try {
    const result = await translateTitle(input, direction);
    return NextResponse.json({ ...result, configured: true });
  } catch (e) {
    if (e instanceof AiUnavailableError) return NextResponse.json({ error: e.message }, { status: 503 });
    throw e;
  }
}
