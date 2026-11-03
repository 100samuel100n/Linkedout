import { bypassesGates } from "@/lib/admin/roles";
import { effectiveTier } from "@/lib/tiers";
import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { getAccountById, getOrCreateAlias, issueContentToken, verifyContentToken } from "@/lib/identity/service";
import { checkRateLimit, RateLimitError } from "@/lib/identity/rate-limit";
import { CompanyError } from "@/lib/content/company-registry";

// Resolves the signed-in account or returns a ready-made error response.
export async function requireAccount({ needVerified = false } = {}) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return { error: NextResponse.json({ error: "You need to be logged in." }, { status: 401 }) };
  const account = await getAccountById(accountId);
  if (!account) return { error: NextResponse.json({ error: "Account not found." }, { status: 401 }) };
  const bypass = bypassesGates(account.role);
  if (needVerified && !bypass) {
    const missing = [];
    if (!account.emailVerified) missing.push("email");
    if (!account.phoneVerified) missing.push("phone number");
    if (missing.length) {
      return { error: NextResponse.json({ error: `Verify your ${missing.join(" and ")} first — company pages need a verified owner.`, code: "VERIFY_FIRST", missing }, { status: 403 }) };
    }
  }
  const alias = await getOrCreateAlias(accountId);
  return { accountId, account, alias, ownerKey: alias.anonymousId, tier: effectiveTier(account) };
}

export async function limit(accountId, action) {
  try { await checkRateLimit(accountId, action); return null; }
  catch (e) {
    if (e instanceof RateLimitError) return NextResponse.json({ error: e.message, code: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": String(Math.ceil(e.retryAfterMs / 1000)) } });
    throw e;
  }
}

export function companyFail(e) {
  if (e instanceof CompanyError) return NextResponse.json({ error: e.message, code: e.code, ...e.extra }, { status: e.status });
  console.error("[company]", e);
  return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
}

export async function displayFor(accountId, mode = "alias") {
  const { token } = await issueContentToken(accountId, ["real", "alias", "anon"].includes(mode) ? mode : "alias");
  return verifyContentToken(token);
}
