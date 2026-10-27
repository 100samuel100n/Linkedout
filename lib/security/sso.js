// Staff single sign-on with any OpenID Connect provider (Google Workspace, Microsoft Entra, Okta, Auth0, Keycloak…).
// Authorization Code flow + PKCE, ID token verified against the provider's JWKS with Node crypto (no extra packages).
// Conditional access: only existing STAFF accounts can use it, the email must be verified by the provider and on an
// allowed domain, and the ABAC policies in Security Operations still apply to everything they then do.
// Env: OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_ALLOWED_DOMAINS (comma list), optional OIDC_REQUIRE_MFA=true
// (requires the provider to report an MFA method in the `amr` claim).
import crypto from "node:crypto";
import { signToken, verifyToken } from "@/lib/identity/crypto";

export const ssoConfigured = () => !!(process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET);
let disco = null, discoAt = 0, jwks = null, jwksAt = 0;
async function discovery() {
  if (disco && Date.now() - discoAt < 3600000) return disco;
  const r = await fetch(`${process.env.OIDC_ISSUER.replace(/\/$/, "")}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error("SSO provider discovery failed.");
  disco = await r.json(); discoAt = Date.now(); return disco;
}
const b64u = (b) => Buffer.from(b).toString("base64url");
export async function beginSso(origin, next = "/admin") {
  const d = await discovery();
  const verifier = b64u(crypto.randomBytes(32)), state = b64u(crypto.randomBytes(16)), nonce = b64u(crypto.randomBytes(16));
  const url = new URL(d.authorization_endpoint);
  url.search = new URLSearchParams({ response_type: "code", client_id: process.env.OIDC_CLIENT_ID, redirect_uri: `${origin}/api/auth/sso/callback`, scope: "openid email profile", state, nonce, code_challenge: b64u(crypto.createHash("sha256").update(verifier).digest()), code_challenge_method: "S256" }).toString();
  const cookie = signToken({ t: "sso", v: verifier, s: state, n: nonce, next: next.startsWith("/") ? next : "/admin", exp: Date.now() + 10 * 60000 });
  return { url: url.toString(), cookie };
}
async function key(kid) {
  const d = await discovery();
  if (!jwks || Date.now() - jwksAt > 3600000 || !jwks.keys.some((k) => k.kid === kid)) { jwks = await (await fetch(d.jwks_uri, { signal: AbortSignal.timeout(5000) })).json(); jwksAt = Date.now(); }
  const jwk = jwks.keys.find((k) => k.kid === kid); if (!jwk) throw new Error("Unknown signing key.");
  return crypto.createPublicKey({ key: jwk, format: "jwk" });
}
export async function finishSso(origin, { code, state }, cookie) {
  const c = cookie && verifyToken(cookie);
  if (!c || c.t !== "sso" || c.s !== state) throw Object.assign(new Error("Sign-in expired. Start again."), { status: 400 });
  const d = await discovery();
  const tr = await fetch(d.token_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(8000),
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: `${origin}/api/auth/sso/callback`, client_id: process.env.OIDC_CLIENT_ID, client_secret: process.env.OIDC_CLIENT_SECRET, code_verifier: c.v }) });
  const tok = await tr.json(); if (!tr.ok || !tok.id_token) throw Object.assign(new Error("The provider rejected the sign-in."), { status: 401 });
  const [h, p, s] = tok.id_token.split(".");
  const head = JSON.parse(Buffer.from(h, "base64url")), claims = JSON.parse(Buffer.from(p, "base64url"));
  if (head.alg !== "RS256") throw Object.assign(new Error("Unsupported token algorithm."), { status: 401 });
  if (!crypto.verify("RSA-SHA256", Buffer.from(`${h}.${p}`), await key(head.kid), Buffer.from(s, "base64url"))) throw Object.assign(new Error("Token signature invalid."), { status: 401 });
  const aud = [].concat(claims.aud);
  if (claims.iss.replace(/\/$/, "") !== d.issuer.replace(/\/$/, "") || !aud.includes(process.env.OIDC_CLIENT_ID) || claims.exp * 1000 < Date.now() || claims.nonce !== c.n) throw Object.assign(new Error("Token not valid for this app."), { status: 401 });
  if (!claims.email || claims.email_verified === false) throw Object.assign(new Error("Your provider hasn't verified this email."), { status: 403 });
  const allowed = (process.env.OIDC_ALLOWED_DOMAINS || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.includes(claims.email.split("@")[1].toLowerCase())) throw Object.assign(new Error("That email domain isn't allowed."), { status: 403 });
  if (process.env.OIDC_REQUIRE_MFA === "true" && !(claims.amr || []).some((m) => ["mfa", "otp", "hwk", "swk", "fido"].includes(m))) throw Object.assign(new Error("Your provider didn't confirm multi-factor sign-in."), { status: 403 });
  return { email: claims.email.toLowerCase(), next: c.next };
}
