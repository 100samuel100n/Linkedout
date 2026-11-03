import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { getAccountById, getOrCreateAlias, issueContentToken, verifyContentToken } from "@/lib/identity/service";
import { checkRateLimit, checkTieredRateLimit, RateLimitError } from "@/lib/identity/rate-limit";
import { restrictionError } from "@/lib/admin/enforce";
import { effectiveTier, perksFor } from "@/lib/tiers";
import { StoryError } from "./service";

export const json = (data, status = 200) => NextResponse.json(data, { status });

// Optional viewer: logged-out readers can read Stories (reading is free for everyone).
export async function viewer() {
  const accountId = await getCurrentAccountId();
  if (!accountId) return { accountId: null, key: null, tier: "basic", perks: perksFor("basic") };
  const account = await getAccountById(accountId);
  const alias = await getOrCreateAlias(accountId);
  const tier = effectiveTier(account);
  return { accountId, account, key: alias.anonymousId, tier, perks: perksFor(tier) };
}

export async function requireViewer({ restriction = null } = {}) {
  const v = await viewer();
  if (!v.accountId) return { error: json({ error: "You need to be logged in." }, 401) };
  if (restriction) { const blocked = await restrictionError(v.accountId, restriction); if (blocked) return { error: blocked }; }
  return v;
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

export async function identityFor(accountId, mode) {
  const { token } = await issueContentToken(accountId, ["real", "alias", "anon"].includes(mode) ? mode : "alias");
  return verifyContentToken(token);
}

export function planRequired(what, plan = "OUT+") {
  return json({ error: `${what} is part of ${plan}.`, code: "PLAN_REQUIRED", plan }, 403);
}

export function fail(e) {
  if (e instanceof StoryError) return json({ error: e.message, code: e.code }, e.status);
  console.error("[stories]", e);
  return json({ error: "Something went wrong." }, 500);
}
