// Phishing-resistant staff sign-in with FIDO2 / WebAuthn security keys and passkeys (uses @simplewebauthn v11).
// A registered key satisfies the same admin 2FA gate as a TOTP code. Challenges are stateless: a signed, 5-minute token
// round-trips through the browser, so it works across multiple servers. Needs HTTPS on the real domain in production.
import crypto from "node:crypto";
import { identityDb } from "@/lib/identity/db";
import { signToken, verifyToken } from "@/lib/identity/crypto";

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
let ready = null;
async function init() {
  if (!ready) ready = identityDb.exec(`
    CREATE TABLE IF NOT EXISTS sec_webauthn (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, public_key TEXT NOT NULL, counter INTEGER NOT NULL DEFAULT 0, transports TEXT, label TEXT, created_at TEXT NOT NULL, last_used_at TEXT);
    CREATE INDEX IF NOT EXISTS sec_webauthn_acct ON sec_webauthn (account_id);`).catch((e) => { ready = null; throw e; });
  return ready;
}
async function rp() {
  const { headers } = await import("next/headers"); const h = await headers();
  const host = (h.get("x-forwarded-host") || h.get("host") || "localhost").split(":")[0];
  const proto = h.get("x-forwarded-proto") || (host === "localhost" ? "http" : "https");
  const origin = process.env.WEBAUTHN_ORIGIN || `${proto}://${h.get("x-forwarded-host") || h.get("host")}`;
  return { rpID: process.env.WEBAUTHN_RP_ID || host, origin, rpName: "LinkedOut Admin" };
}
const challengeToken = (accountId, challenge, t) => signToken({ t, a: accountId, c: challenge, exp: Date.now() + 5 * 60000 });
function readChallenge(token, accountId, t) { const p = token && verifyToken(token); if (!p || p.t !== t || p.a !== accountId) throw bad("That security-key step expired. Start again."); return p.c; }

export async function listKeys(accountId) { await init(); return (await identityDb.prepare("SELECT id, label, created_at, last_used_at FROM sec_webauthn WHERE account_id = ? ORDER BY created_at").all(accountId)).map((k) => ({ id: k.id, label: k.label, createdAt: k.created_at, lastUsedAt: k.last_used_at })); }
export async function hasKeys(accountId) { await init(); return !!(await identityDb.prepare("SELECT 1 x FROM sec_webauthn WHERE account_id = ? LIMIT 1").get(accountId)); }
export async function removeKey(accountId, id) { await init(); await identityDb.prepare("DELETE FROM sec_webauthn WHERE id = ? AND account_id = ?").run(id, accountId); return { ok: true }; }

export async function registrationOptions(staff) {
  await init();
  const { generateRegistrationOptions } = await import("@simplewebauthn/server");
  const { rpID, rpName } = await rp();
  const existing = await identityDb.prepare("SELECT id, transports FROM sec_webauthn WHERE account_id = ?").all(staff.id);
  const options = await generateRegistrationOptions({
    rpName, rpID, userName: staff.email || staff.pseudonym || staff.id, userDisplayName: staff.pseudonym || "Staff",
    userID: new TextEncoder().encode(staff.id), attestationType: "none",
    excludeCredentials: existing.map((k) => ({ id: k.id, transports: k.transports ? JSON.parse(k.transports) : undefined })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
  return { options, token: challengeToken(staff.id, options.challenge, "wa-reg") };
}
export async function verifyRegistration(staff, { response, token, label }) {
  await init();
  const { verifyRegistrationResponse } = await import("@simplewebauthn/server");
  const { rpID, origin } = await rp();
  const v = await verifyRegistrationResponse({ response, expectedChallenge: readChallenge(token, staff.id, "wa-reg"), expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false });
  if (!v.verified || !v.registrationInfo) throw bad("That security key couldn't be verified.");
  const c = v.registrationInfo.credential;
  await identityDb.prepare("INSERT INTO sec_webauthn (id, account_id, public_key, counter, transports, label, created_at) VALUES (?,?,?,?,?,?,?)")
    .run(c.id, staff.id, Buffer.from(c.publicKey).toString("base64url"), c.counter || 0, JSON.stringify(response.response?.transports || []), String(label || "Security key").slice(0, 40), new Date().toISOString());
  return { ok: true };
}
export async function authenticationOptions(staff) {
  await init();
  const { generateAuthenticationOptions } = await import("@simplewebauthn/server");
  const { rpID } = await rp();
  const keys = await identityDb.prepare("SELECT id, transports FROM sec_webauthn WHERE account_id = ?").all(staff.id);
  if (!keys.length) throw bad("No security key is registered for this account.", 404);
  const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred", allowCredentials: keys.map((k) => ({ id: k.id, transports: k.transports ? JSON.parse(k.transports) : undefined })) });
  return { options, token: challengeToken(staff.id, options.challenge, "wa-auth") };
}
export async function verifyAuthentication(staff, { response, token }) {
  await init();
  const { verifyAuthenticationResponse } = await import("@simplewebauthn/server");
  const { rpID, origin } = await rp();
  const key = await identityDb.prepare("SELECT * FROM sec_webauthn WHERE id = ? AND account_id = ?").get(response?.id, staff.id);
  if (!key) throw bad("That key isn't registered to this account.", 401);
  const v = await verifyAuthenticationResponse({ response, expectedChallenge: readChallenge(token, staff.id, "wa-auth"), expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false,
    credential: { id: key.id, publicKey: Buffer.from(key.public_key, "base64url"), counter: key.counter, transports: key.transports ? JSON.parse(key.transports) : undefined } });
  if (!v.verified) throw bad("Security key check failed.", 401);
  await identityDb.prepare("UPDATE sec_webauthn SET counter = ?, last_used_at = ? WHERE id = ?").run(v.authenticationInfo.newCounter, new Date().toISOString(), key.id);
  return { ok: true };
}
