import { challengeIfNeeded } from "@/lib/identity/mfa";
import { NextResponse } from "next/server";
import { verifyAppleIdentityToken } from "@/lib/oauth";
import { findOrCreateAppleAccount, signSession } from "@/lib/identity/service";

// Native counterpart to /api/auth/apple/callback. expo-apple-authentication's
// signInAsync() gets an identityToken directly from iOS's native Sign in
// with Apple dialog and, on the very first authorization only, a
// fullName — the client sends both here. Same signature-verification
// caveat as the web flow: see lib/oauth.js's verifyAppleIdentityToken and
// the README's Apple Sign In section for exactly what's still needed.
export async function POST(request) {
  if (process.env.APPLE_SIGNIN_ENABLED !== "true") return Response.json({ error: "Sign in with Apple is coming soon.", code: "APPLE_COMING_SOON" }, { status: 503 });
  const body = await request.json().catch(() => null);
  const identityToken = body?.identityToken;
  const fullName = body?.fullName; // { givenName, familyName } | null — only present on first sign-in
  if (!identityToken) return NextResponse.json({ error: "Missing identityToken." }, { status: 400 });

  try {
    const { appleId, email } = verifyAppleIdentityToken(identityToken);
    const realName = fullName ? [fullName.givenName, fullName.familyName].filter(Boolean).join(" ") : null;
    const account = await findOrCreateAppleAccount({ appleId, email, realName: realName || email });
    const challenge = await challengeIfNeeded(account.id);
    if (challenge) return NextResponse.json({ twoFactorRequired: true, challenge });
    const token = await signSession(account.id);
    return NextResponse.json({
      token,
      email: account.email,
      realName: account.realName,
      pseudonym: account.pseudonym,
    });
  } catch (e) {
    console.error("Apple native token verification failed:", e.message);
    return NextResponse.json({ error: "Could not verify Apple sign-in." }, { status: 401 });
  }
}
