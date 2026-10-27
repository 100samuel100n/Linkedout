import { challengeIfNeeded } from "@/lib/identity/mfa";
import { NextResponse } from "next/server";
import { verifyGoogleIdToken } from "@/lib/oauth";
import { findOrCreateGoogleAccount, signSession, isAccountDeactivated, reactivateAccount } from "@/lib/identity/service";
import { getAccountGate } from "@/lib/admin/enforce";

// Native counterpart to /api/auth/google/callback for the "Android client" sign-in mode: the app gets a
// Google id_token from the Google Sign-In SDK (Credential Manager) on the device, then POSTs it
// here instead of following a server-side redirect — there's no
// meaningful "redirect back to the app" on native the way there is on
// web, so the token exchange happens over a normal API call and the
// client stores the resulting session token itself, exactly like
// email/password signup already does.
export async function POST(request) {
  const body = await request.json().catch(() => null);
  const idToken = body?.idToken;
  if (!idToken) return NextResponse.json({ error: "Missing idToken." }, { status: 400 });

  try {
    const { googleId, email, realName } = await verifyGoogleIdToken(idToken);
    const account = await findOrCreateGoogleAccount({ googleId, email, realName });
    const gate = await getAccountGate(account.id);
    if (gate.blocked) return NextResponse.json({ error: gate.message, code: "ACCOUNT_RESTRICTED" }, { status: 403 });
    const challenge = await challengeIfNeeded(account.id);
    if (challenge) return NextResponse.json({ twoFactorRequired: true, challenge });
    if (await isAccountDeactivated(account.id)) await reactivateAccount(account.id);
    const token = await signSession(account.id);
    return NextResponse.json({
      token,
      email: account.email,
      realName: account.realName,
      pseudonym: account.pseudonym,
    });
  } catch (e) {
    console.error("Google native token verification failed:", e.message);
    return NextResponse.json({ error: "Could not verify Google sign-in." }, { status: 401 });
  }
}
