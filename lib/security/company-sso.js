// Single sign-on for a company's dashboard, with the company's OWN OpenID Connect provider (Microsoft Entra ID, Google Workspace, Okta, Auth0…),
// plus SCIM 2.0 provisioning of representatives. Same hardened flow as staff SSO (lib/security/sso.js): Authorization Code + PKCE,
// RS256 ID token verified against the provider's JWKS with Node crypto, nonce and audience checks. SAML is NOT implemented
// (it needs XML signature verification, which we won't hand-roll); OIDC is supported by every major identity provider.
//
// What SSO adds: when it is ON for a company, its dashboard only opens after the person has also signed in through the company's
// provider within the session window, and the provider's verified email must equal the LinkedOut account's email. Nobody can be
// "added" by the provider alone: SCIM only attaches EXISTING LinkedOut accounts, never creates one.
import crypto from "node:crypto";
import dns from "node:dns/promises";
import { contentDb } from "../content/db.js";
import { signToken, verifyToken } from "../identity/crypto.js";
import { StoryError } from "../stories/service.js";

const nowIso = () => new Date().toISOString();
const b64u = (b) => Buffer.from(b).toString("base64url");
const secretKey = () => crypto.createHash("sha256").update(`company-sso:${process.env.IDENTITY_SIGNING_SECRET || "dev-only"}`).digest();
export function sealSecret(plain) { const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", secretKey(), iv); const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]); return `${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${enc.toString("base64")}`; }
export function openSecret(sealed) { const [iv, tag, enc] = String(sealed).split(".").map((x) => Buffer.from(x, "base64")); const d = crypto.createDecipheriv("aes-256-gcm", secretKey(), iv); d.setAuthTag(tag); return Buffer.concat([d.update(enc), d.final()]).toString("utf8"); }

export async function getSso(companyId) { return contentDb.prepare("SELECT * FROM company_sso WHERE company_id = ?").get(companyId); }
export const ssoRequired = async (companyId) => { const s = await getSso(companyId); return !!(s && s.enabled); };

const cache = new Map();   // issuer → { disco, jwks, at }
async function discovery(issuer) {
  const hit = cache.get(issuer); if (hit && Date.now() - hit.at < 3600000) return hit;
  const host = new URL(issuer).hostname, addrs = await dns.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length || addrs.some((a) => /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|fc|fd|fe80)/i.test(a.address))) throw new StoryError("That identity provider isn't reachable from the public internet.");
  const r = await fetch(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(6000), redirect: "error" });
  if (!r.ok) throw new StoryError("Couldn't read the provider's OpenID configuration. Check the issuer URL.");
  const disco = await r.json(); const v = { disco, jwks: null, at: Date.now() }; cache.set(issuer, v); return v;
}
async function jwk(issuer, kid) {
  const v = await discovery(issuer);
  if (!v.jwks || !v.jwks.keys.some((k) => k.kid === kid)) v.jwks = await (await fetch(v.disco.jwks_uri, { signal: AbortSignal.timeout(6000), redirect: "error" })).json();
  const k = v.jwks.keys.find((x) => x.kid === kid); if (!k) throw new StoryError("Unknown signing key.", 401);
  return crypto.createPublicKey({ key: k, format: "jwk" });
}

export async function saveSso(companyId, { issuer, clientId, clientSecret, domains, requireMfa, enabled, sessionMinutes }) {
  const iss = String(issuer || "").trim(); if (!/^https:\/\/[^\s]+$/.test(iss)) throw new StoryError("The issuer must be an https:// URL.");
  const cur = await getSso(companyId); const secret = clientSecret ? sealSecret(String(clientSecret)) : cur?.client_secret_enc; if (!secret) throw new StoryError("Add the client secret.");
  const doms = (Array.isArray(domains) ? domains : String(domains || "").split(/[\s,]+/)).map((d) => d.trim().toLowerCase()).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)).slice(0, 10); if (!doms.length) throw new StoryError("Add at least one allowed email domain.");
  const mins = Math.max(15, Math.min(720, Math.round(Number(sessionMinutes) || 480)));
  if (enabled) await discovery(iss);   // fail now, not at 9am on a Monday
  await contentDb.prepare(`INSERT INTO company_sso (company_id, issuer, client_id, client_secret_enc, domains, require_mfa, enabled, session_minutes, updated_at) VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT (company_id) DO UPDATE SET issuer = EXCLUDED.issuer, client_id = EXCLUDED.client_id, client_secret_enc = EXCLUDED.client_secret_enc, domains = EXCLUDED.domains, require_mfa = EXCLUDED.require_mfa, enabled = EXCLUDED.enabled, session_minutes = EXCLUDED.session_minutes, updated_at = EXCLUDED.updated_at`)
    .run(companyId, iss, String(clientId || "").trim(), secret, JSON.stringify(doms), requireMfa ? 1 : 0, enabled ? 1 : 0, mins, nowIso());
}
export async function publicSso(companyId) { const s = await getSso(companyId); return s ? { issuer: s.issuer, clientId: s.client_id, domains: JSON.parse(s.domains || "[]"), requireMfa: !!s.require_mfa, enabled: !!s.enabled, sessionMinutes: s.session_minutes, hasSecret: true, hasScim: !!s.scim_hash } : null; }

export async function beginCompanySso(origin, companyId, next) {
  const s = await getSso(companyId); if (!s || !s.enabled) throw new StoryError("SSO isn't turned on for this company.", 400);
  const { disco } = await discovery(s.issuer);
  const verifier = b64u(crypto.randomBytes(32)), state = b64u(crypto.randomBytes(16)), nonce = b64u(crypto.randomBytes(16));
  const url = new URL(disco.authorization_endpoint);
  url.search = new URLSearchParams({ response_type: "code", client_id: s.client_id, redirect_uri: `${origin}/api/auth/company-sso/callback`, scope: "openid email profile", state, nonce, code_challenge: b64u(crypto.createHash("sha256").update(verifier).digest()), code_challenge_method: "S256" }).toString();
  return { url: url.toString(), cookie: signToken({ t: "csso", co: companyId, v: verifier, s: state, n: nonce, next: next?.startsWith("/") ? next : `/companies/${companyId}/dashboard`, exp: Date.now() + 10 * 60000 }) };
}
export async function finishCompanySso(origin, { code, state }, cookie) {
  const c = cookie && verifyToken(cookie); if (!c || c.t !== "csso" || c.s !== state) throw new StoryError("Sign-in expired. Start again.", 400);
  const s = await getSso(c.co); if (!s || !s.enabled) throw new StoryError("SSO isn't turned on for this company.", 400);
  const { disco } = await discovery(s.issuer);
  const tr = await fetch(disco.token_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(8000), redirect: "error",
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: `${origin}/api/auth/company-sso/callback`, client_id: s.client_id, client_secret: openSecret(s.client_secret_enc), code_verifier: c.v }) });
  const tok = await tr.json().catch(() => ({})); if (!tr.ok || !tok.id_token) throw new StoryError("The provider rejected the sign-in.", 401);
  const [h, p, sig] = tok.id_token.split("."), head = JSON.parse(Buffer.from(h, "base64url")), claims = JSON.parse(Buffer.from(p, "base64url"));
  if (head.alg !== "RS256") throw new StoryError("Unsupported token algorithm.", 401);
  if (!crypto.verify("RSA-SHA256", Buffer.from(`${h}.${p}`), await jwk(s.issuer, head.kid), Buffer.from(sig, "base64url"))) throw new StoryError("Token signature invalid.", 401);
  if (String(claims.iss).replace(/\/$/, "") !== String(disco.issuer).replace(/\/$/, "") || ![].concat(claims.aud).includes(s.client_id) || claims.exp * 1000 < Date.now() || claims.nonce !== c.n) throw new StoryError("Token not valid for this app.", 401);
  if (!claims.email || claims.email_verified === false) throw new StoryError("Your provider hasn't verified this email.", 403);
  const doms = JSON.parse(s.domains || "[]"); if (!doms.includes(claims.email.split("@")[1].toLowerCase())) throw new StoryError("That email domain isn't allowed for this company.", 403);
  if (s.require_mfa && !(claims.amr || []).some((m) => ["mfa", "otp", "hwk", "swk", "fido"].includes(m))) throw new StoryError("Your provider didn't confirm multi-factor sign-in.", 403);
  return { email: claims.email.toLowerCase(), companyId: c.co, next: c.next, minutes: s.session_minutes };
}
// The proof that this browser completed company SSO: a signed, short-lived cookie bound to the company and the LinkedOut account.
export const ssoCookieName = (companyId) => `lo_cosso_${String(companyId).replace(/[^a-z0-9]/gi, "").slice(0, 24)}`;
export const makeSsoSession = (companyId, accountId, minutes) => signToken({ t: "cosess", co: companyId, a: accountId, exp: Date.now() + minutes * 60000 });
export const checkSsoSession = (cookie, companyId, accountId) => { const c = cookie && verifyToken(cookie); return !!(c && c.t === "cosess" && c.co === companyId && c.a === accountId && c.exp > Date.now()); };

// ---- SCIM 2.0 (Users). The bearer token identifies the company; it is shown once and stored as a hash.
export async function rotateScimToken(companyId) {
  const s = await getSso(companyId); if (!s) throw new StoryError("Save your SSO settings first.");
  const token = `lo_scim_${crypto.randomBytes(24).toString("base64url")}`;
  await contentDb.prepare("UPDATE company_sso SET scim_hash = ? WHERE company_id = ?").run(crypto.createHash("sha256").update(token).digest("hex"), companyId); return token;
}
export async function companyForScim(bearer) { const r = await contentDb.prepare("SELECT company_id FROM company_sso WHERE scim_hash = ?").get(crypto.createHash("sha256").update(String(bearer || "")).digest("hex")); return r?.company_id || null; }
