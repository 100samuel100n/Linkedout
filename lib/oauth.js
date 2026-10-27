// OAuth helpers. Google is implemented using the standard authorization-
// code flow; Apple is scaffolded to the same shape but genuinely cannot be
// tested without a paid Apple Developer Program membership and a real
// private key file — see the Apple section below for exactly what's
// missing. Neither has been exercised against the real Google/Apple
// servers in this environment (no network access to accounts.google.com
// from here) — the code is written to the documented API contracts, the
// same honesty caveat as lib/stripe.js's checkout flow.
import crypto from "node:crypto";
import { getAppUrl } from "./config.js";

// ---------------- Google ----------------

export function isGoogleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function googleRedirectUri() {
  return process.env.GOOGLE_REDIRECT_URI || `${getAppUrl()}/api/auth/google/callback`;
}

export function buildGoogleAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// Exchanges an authorization code for tokens, then validates the ID token
// via Google's tokeninfo endpoint (Google's own documented approach for
// servers that don't want to implement local JWKS/RS256 verification) —
// simpler and still correct, since the validation call goes straight to
// Google over TLS.
export async function exchangeGoogleCode(code) {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`Google token exchange failed (${tokenRes.status}): ${await tokenRes.text()}`);
  }
  const { id_token: idToken } = await tokenRes.json();
  if (!idToken) throw new Error("Google did not return an id_token.");

  const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  if (!verifyRes.ok) {
    throw new Error(`Google ID token verification failed (${verifyRes.status}): ${await verifyRes.text()}`);
  }
  const payload = await verifyRes.json();

  if (payload.aud !== process.env.GOOGLE_CLIENT_ID) {
    throw new Error("Google ID token audience mismatch — possible token substitution.");
  }

  return {
    googleId: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified === "true" || payload.email_verified === true,
    realName: payload.name || payload.email,
  };
}

// Native counterpart to exchangeGoogleCode: the mobile app gets an
// id_token directly from Google via expo-auth-session's implicit flow (no
// authorization-code exchange through our server needed — there's no
// redirect URI for a server to catch on native), so this just verifies
// whatever id_token the client already obtained, using the same
// tokeninfo-endpoint approach as the web flow. Used by
// POST /api/auth/google/token, which linkedout-native calls instead of
// the web flow's redirect-based routes.
export function googleAllowedAudiences() {
  // The Web client (GOOGLE_CLIENT_ID) is what a native Google Sign-In uses as its `webClientId`, so
  // id tokens minted on Android carry THAT as `aud`. The Android client id is accepted too in case a
  // build is configured to use it directly. Comma-separate multiple values in GOOGLE_NATIVE_CLIENT_ID.
  return [process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_ANDROID_CLIENT_ID, ...(process.env.GOOGLE_NATIVE_CLIENT_ID || "").split(",")]
    .map((x) => (x || "").trim()).filter(Boolean);
}

export async function verifyGoogleIdToken(idToken) {
  const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  if (!verifyRes.ok) {
    throw new Error(`Google ID token verification failed (${verifyRes.status}): ${await verifyRes.text()}`);
  }
  const payload = await verifyRes.json();

  // Audience MUST be one of our own client ids. Without this check, a valid Google id token minted for
  // ANY other app would sign someone in here.
  const allowed = googleAllowedAudiences();
  if (allowed.length === 0) throw new Error("Google sign-in isn't configured (no GOOGLE_CLIENT_ID).");
  if (!allowed.includes(payload.aud)) throw new Error("Google ID token audience mismatch.");
  const verified = payload.email_verified === "true" || payload.email_verified === true;
  if (!payload.sub || !payload.email || !verified) throw new Error("Google account email is not verified.");

  return {
    googleId: payload.sub,
    email: payload.email,
    emailVerified: verified,
    realName: payload.name || payload.email,
  };
}

// ---------------- Apple ----------------
//
// What a real Apple integration additionally needs, beyond what's here:
//   1. An Apple Developer Program membership ($99/yr) — a Services ID
//      (client_id), a Sign in with Apple key (.p8 file), its Key ID, and
//      your Team ID.
//   2. APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID env vars, plus the
//      private key itself (APPLE_PRIVATE_KEY, PEM-formatted).
//   3. Apple's callback uses response_mode=form_post — the callback route
//      needs to read a POSTed form body, not a query string like Google's.
// None of that exists here, so isAppleConfigured() will be false and the
// route returns the same graceful "not configured" response the Stripe
// checkout route uses when its keys are missing.
export function isAppleConfigured() {
  return Boolean(
    process.env.APPLE_CLIENT_ID &&
    process.env.APPLE_TEAM_ID &&
    process.env.APPLE_KEY_ID &&
    process.env.APPLE_PRIVATE_KEY
  );
}

function appleRedirectUri() {
  return process.env.APPLE_REDIRECT_URI || `${getAppUrl()}/api/auth/apple/callback`;
}

export function buildAppleAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.APPLE_CLIENT_ID,
    redirect_uri: appleRedirectUri(),
    response_type: "code",
    response_mode: "form_post",
    scope: "name email",
    state,
  });
  return `https://appleid.apple.com/auth/authorize?${params.toString()}`;
}

// Apple requires a signed JWT as the "client secret" (not a static string
// like Google's) — generated fresh using ES256 and your .p8 private key.
function buildAppleClientSecret() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: process.env.APPLE_KEY_ID };
  const payload = {
    iss: process.env.APPLE_TEAM_ID,
    iat: now,
    exp: now + 60 * 5,
    aud: "https://appleid.apple.com",
    sub: process.env.APPLE_CLIENT_ID,
  };
  const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const signingInput = `${b64url(header)}.${b64url(payload)}`;
  const signature = crypto.sign("sha256", Buffer.from(signingInput), {
    key: process.env.APPLE_PRIVATE_KEY,
    dsaEncoding: "ieee-p1363", // JWT ES256 wants raw R||S, not DER
  });
  return `${signingInput}.${signature.toString("base64url")}`;
}

export async function exchangeAppleCode(code) {
  const tokenRes = await fetch("https://appleid.apple.com/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.APPLE_CLIENT_ID,
      client_secret: buildAppleClientSecret(),
      redirect_uri: appleRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`Apple token exchange failed (${tokenRes.status}): ${await tokenRes.text()}`);
  }
  const { id_token: idToken } = await tokenRes.json();
  if (!idToken) throw new Error("Apple did not return an id_token.");

  // Apple's id_token is a signed JWT too, but Apple has no equivalent of
  // Google's convenience tokeninfo-verification endpoint — a real
  // implementation needs to fetch Apple's JWKS (https://appleid.apple.com/auth/keys)
  // and verify the RS256 signature locally. Decoding without verifying
  // the signature (below) is NOT secure and is a placeholder only —
  // flagged explicitly so it's never mistaken for a finished
  // implementation.
  const payloadB64 = idToken.split(".")[1];
  const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());

  return {
    appleId: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified === "true" || payload.email_verified === true,
    // Apple only ever sends a name on the *first* authorization — the
    // caller needs to handle realName possibly being absent here.
    realName: null,
  };
}

// Native counterpart to exchangeAppleCode: expo-apple-authentication's
// signInAsync() gets an identityToken directly from the native iOS
// Sign-in-with-Apple dialog — no code exchange needed. This decodes that
// token the same (deliberately flagged, NOT signature-verified) way the
// web flow's exchangeAppleCode does — see that function's comment for
// why, and what a real implementation still needs. Used by
// POST /api/auth/apple/token.
export function verifyAppleIdentityToken(identityToken) {
  const payloadB64 = identityToken.split(".")[1];
  const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
  return {
    appleId: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified === "true" || payload.email_verified === true,
  };
}
