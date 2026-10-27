import { cookies, headers } from "next/headers";
import { getAccountGate, recordActivity } from "./admin/enforce.js";
import { identityDb } from "./identity/db.js";
import { signSession, verifySession } from "./identity/service.js";
import { refreshPlanConfig } from "./plan-config.js";
import { getCachedSession, setCachedSession, invalidateSession } from "./session-cache.js";

const COOKIE_NAME = "lo_session";

// A signed session token's signature can still verify correctly even
// after the account it names is gone — reseeding the database (or
// restoring from an older backup) doesn't revoke tokens that were issued
// against the previous data. Without this check, a stale token would
// pass verifySession() and isAccountDeactivated() (which reads "no such
// row" as "not deactivated," not "invalid") and then blow up downstream
// with a foreign-key error the first time anything tried to write against
// that ghost account id — exactly what getOrCreateAlias saw. Treating a
// missing account as "no session" here, the one chokepoint every route
// already goes through, closes that for good instead of pushing the
// crash further down the stack.
// ONE query decides whether a signed token is still usable: the account must
// exist, not be deactivated, not be locked/suspended/banned (see
// lib/admin/enforce.js), and not owe a forced password reset. The answer is
// cached for 5 s per account so a burst of taps (likes, reactions, bookmarks)
// doesn't re-run it on every request — the trade-off is that an enforcement
// or restore can take up to 5 s to bite. Also stamps last_seen_at / the
// daily-active table for the admin Command Center.
async function sessionAllowed(accountId) {
  const hit = getCachedSession(accountId);
  if (hit) return hit.ok;
  const row = await identityDb.prepare("SELECT deactivated FROM accounts WHERE id = ?").get(accountId);
  const locked = await import("@/lib/security/core").then((m) => m.accountFlag(accountId, "locked")).catch(() => false);
  const ok = !!row && !row.deactivated && !locked && !(await getAccountGate(accountId)).blocked;
  setCachedSession(accountId, ok);
  if (ok) recordActivity(accountId);
  return ok;
}

export async function createSessionCookie(accountId) {
  invalidateSession(accountId); // a fresh sign-in must not be judged by a cached answer from before reactivation
  const token = signSession(accountId);
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

// Two auth paths, same underlying signed token (see lib/identity/crypto.js):
//   - Web: an httpOnly cookie, set by createSessionCookie() above. The
//     browser sends it automatically; JS on the page never touches it.
//   - Native app: no cookie jar to rely on, so the mobile app stores the
//     same token itself (via expo-secure-store) and sends it as
//     `Authorization: Bearer <token>` instead. Both paths verify with the
//     exact same verifySession() — there's no separate, weaker check for
//     mobile.
//
// A deactivated account is treated as logged out here — this is what
// makes deactivation actually block access from a cached native Bearer
// token, not just a web session cookie: our signed tokens have no
// server-side revocation list, so a token issued before deactivation
// would otherwise keep working until it naturally expires. Checking here,
// the one chokepoint every route already goes through, closes that gap
// without needing every route to remember to check separately. Logging in
// again with the right password reactivates (see the login route).
export async function getCurrentAccountId() {
  refreshPlanConfig().catch(() => {}); // admin-edited plan limits reach every request within ~15s
  await import("@/lib/admin/rbac").then((m) => m.ensureRolesFresh()).catch(() => {}); // admin-edited roles likewise
  // Bearer first: the native app sends an explicit token, and its HTTP client
  // also keeps a cookie jar. If the cookie won, a previous account's leftover
  // cookie would silently override the account the user just signed in with.
  const hdrs = await headers();
  const authHeader = hdrs.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const bearerToken = authHeader.slice("Bearer ".length).trim();
    const accountId = verifySession(bearerToken);
    if (accountId && (await sessionAllowed(accountId))) return accountId;
  }

  const store = await cookies();
  const cookieToken = store.get(COOKIE_NAME)?.value;
  if (cookieToken) {
    const accountId = verifySession(cookieToken);
    if (accountId && (await sessionAllowed(accountId))) return accountId;
  }

  return null;
}
