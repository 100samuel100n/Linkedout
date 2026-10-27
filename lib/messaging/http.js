import { bypassesGates } from "@/lib/admin/roles";
import { effectiveTier } from "@/lib/tiers";
import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { getAccountById, getOrCreateAlias } from "@/lib/identity/service";
import { checkRateLimit, checkTieredRateLimit, RateLimitError } from "@/lib/identity/rate-limit";
import { DmError } from "@/lib/messaging/service";

// Resolves the signed-in member (alias id only) or returns an error response.
// Messaging requires a verified email, so throwaway accounts can't DM.
export async function requireMember({ verified = true } = {}) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return { error: NextResponse.json({ error: "You need to be logged in." }, { status: 401 }) };
  const account = await getAccountById(accountId);
  if (!account) return { error: NextResponse.json({ error: "Account not found." }, { status: 401 }) };
  if (verified && !account.emailVerified && !bypassesGates(account.role)) {
    return { error: NextResponse.json({ error: "Verify your email to use messages.", code: "VERIFY_EMAIL" }, { status: 403 }) };
  }
  const alias = await getOrCreateAlias(accountId);
  return { accountId, account, me: alias.anonymousId, tier: effectiveTier(account) };
}

export async function limited(accountId, action, tier) {
  try {
    if (tier) await checkTieredRateLimit(accountId, action, tier); else await checkRateLimit(accountId, action);
    return null;
  } catch (e) {
    if (e instanceof RateLimitError) return NextResponse.json({ error: e.message, code: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": String(Math.ceil(e.retryAfterMs / 1000)) } });
    throw e;
  }
}

export function dmFail(e) {
  if (e instanceof DmError) return NextResponse.json({ error: e.message, code: e.code, ...e.extra }, { status: e.status });
  console.error("[messages]", e);
  return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
}
