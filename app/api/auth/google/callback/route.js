import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isStaffRole } from "@/lib/admin/roles";
import { getAccountById, findOrCreateGoogleAccount, isAccountDeactivated, reactivateAccount } from "@/lib/identity/service";
import { getAccountGate } from "@/lib/admin/enforce";
import { exchangeGoogleCode } from "@/lib/oauth";
import { createSessionCookie } from "@/lib/session";
import { getAppUrl } from "@/lib/config";
import { verifyToken } from "@/lib/identity/crypto";
import { challengeIfNeeded } from "@/lib/identity/mfa";
import { makeExchangeTicket } from "@/lib/identity/native-ticket";
import { appReturnResponse } from "@/lib/identity/app-return";

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const appUrl = getAppUrl();

  const store = await cookies();
  const expectedState = store.get("lo_oauth_state")?.value;
  store.delete("lo_oauth_state");

  // A state that decodes to { r } came from the native app: finish by redirecting
  // to its return URL instead of setting a website cookie.
  const native = state && verifyToken(state);
  const ret = native?.r;
  const back = (q) => `${ret}${ret.includes("?") ? "&" : "?"}${q}`;

  if (!code || !state || state !== expectedState) {
    console.warn("[auth] google callback rejected: state/code missing or mismatched", JSON.stringify({ hasCode: !!code, hasState: !!state, hasStateCookie: !!expectedState }));
    return ret ? appReturnResponse(back("error=oauth_failed"), { failed: true }) : NextResponse.redirect(`${appUrl}/login?error=oauth_state_mismatch`);
  }
  try {
    const { googleId, email, realName } = await exchangeGoogleCode(code);
    const account = await findOrCreateGoogleAccount({ googleId, email, realName });
    // Diagnostic line for the hosting logs (no secrets): what the server found for this sign-in.
    const diag = await getAccountGate(account.id);
    console.log("[auth] google callback", JSON.stringify({ via: ret ? "app" : "web", account: account.id, blocked: !!diag.blocked, deactivated: await isAccountDeactivated(account.id), mfa: await challengeIfNeeded(account.id) ? true : false }));
    if (ret) return appReturnResponse(back(`code=${encodeURIComponent(makeExchangeTicket(account.id))}`));
    // Same rules as password login: a restricted account gets told why (instead of silently landing signed-out),
    // and a deactivated one is reactivated by signing in again (see app/api/auth/login/route.js).
    const gate = await getAccountGate(account.id);
    if (gate.blocked) {
      console.warn("[auth] Google sign-in blocked:", account.id, gate.message);
      return NextResponse.redirect(`${appUrl}/login?error=account_restricted`);
    }
    const mfa = await challengeIfNeeded(account.id);
    if (mfa) return NextResponse.redirect(`${appUrl}/login?mfa=${encodeURIComponent(mfa)}`);
    if (await isAccountDeactivated(account.id)) {
      console.log("[auth] Google sign-in reactivated a deactivated account:", account.id);
      await reactivateAccount(account.id);
    }
    await createSessionCookie(account.id);
    console.log("[auth] google session cookie set for", account.id);
    return NextResponse.redirect(`${appUrl}${isStaffRole((await getAccountById(account.id))?.role) ? "/admin" : "/profile"}`);
  } catch (e) {
    console.error("Google OAuth callback failed:", e.message);
    return ret ? appReturnResponse(back("error=oauth_failed"), { failed: true }) : NextResponse.redirect(`${appUrl}/login?error=oauth_failed`);
  }
}
