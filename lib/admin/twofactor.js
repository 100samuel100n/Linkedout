import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import { identityDb } from "@/lib/identity/db";
import { signToken, verifyToken } from "@/lib/identity/crypto";
import { seal, unseal, verifyTotp, newSecret, otpauthUri, newRecoveryCodes, hashCode } from "./totp";

// Staff must pass a second factor before ANY /api/admin data call works.
// After a correct code the server issues a signed "lo_2fa" token bound to the
// account (12 h). Web gets it as an httpOnly cookie; native keeps the token and
// sends it as `X-Admin-2FA`. Staff who haven't enrolled are forced to enrol.
const TTL = 12 * 3600 * 1000;
export const issue2faToken = (accountId) => signToken({ t: "2fa", a: accountId, exp: Date.now() + TTL });

let mfaReady = null;
async function mfaTables() {
  if (!mfaReady) mfaReady = identityDb.exec(`CREATE TABLE IF NOT EXISTS staff_mfa_email (account_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, code_hash TEXT, expires_at TEXT, attempts INTEGER NOT NULL DEFAULT 0, last_sent TEXT)`).catch((e) => { mfaReady = null; throw e; });
  return mfaReady;
}
const maskEmail = (e) => String(e || "").replace(/^(.).*(@.*)$/, "$1•••$2");

// Which second factors this staff member has. ANY enrolled method counts as "2FA is on", and any one of them passes the gate:
//  authenticator app (TOTP), emailed code, security key / passkey, single-use recovery codes. SSO is separate (it signs in).
export async function twoFactorState(accountId) {
  await mfaTables();
  const r = await identityDb.prepare("SELECT totp_enabled, totp_recovery, email FROM accounts WHERE id = ?").get(accountId);
  const em = await identityDb.prepare("SELECT enabled FROM staff_mfa_email WHERE account_id = ?").get(accountId);
  const keys = await import("@/lib/security/webauthn").then((m) => m.hasKeys(accountId)).catch(() => false);
  const emailAllowed = await import("@/lib/security/core").then(async (m) => (await m.getSettings()).emailMfa).catch(() => true);
  const methods = { totp: !!r?.totp_enabled, email: !!em?.enabled && emailAllowed, key: keys, recovery: JSON.parse(r?.totp_recovery || "[]").length };
  const enabled = methods.totp || methods.email || methods.key;
  const store = await cookies(), h = await headers();
  const tok = store.get("lo_2fa")?.value || h.get("x-admin-2fa");
  const p = tok && verifyToken(tok);
  return { enabled, verified: enabled && !!p && p.t === "2fa" && p.a === accountId, methods, emailAllowed, emailTo: maskEmail(r?.email), hasEmail: !!r?.email };
}

// Setup is IDEMPOTENT: reopening the page returns the SAME pending secret. (It used to mint a new secret on every load,
// so the QR you had scanned no longer matched what the server stored and every code was "wrong".) Pass fresh=true to
// deliberately start over.
export async function beginSetup(staff, { fresh = false } = {}) {
  const r = await identityDb.prepare("SELECT totp_secret, totp_enabled FROM accounts WHERE id = ?").get(staff.id);
  let secret = null;
  if (!fresh && r?.totp_secret && !r.totp_enabled) { try { secret = unseal(r.totp_secret); } catch { secret = null; } }
  if (!secret) { secret = newSecret(); await identityDb.prepare("UPDATE accounts SET totp_secret = ?, totp_enabled = 0 WHERE id = ?").run(seal(secret), staff.id); }
  return { secret, uri: otpauthUri(secret, staff.email || staff.pseudonym || staff.id) };
}

export async function confirmSetup(staff, code) {
  const r = await identityDb.prepare("SELECT totp_secret, totp_enabled FROM accounts WHERE id = ?").get(staff.id);
  if (!r?.totp_secret) throw Object.assign(new Error("Start setup first."), { status: 400 });
  if (r.totp_enabled) throw Object.assign(new Error("2FA is already on."), { status: 400 });
  if (!verifyTotp(unseal(r.totp_secret), code)) throw Object.assign(new Error("That code is wrong or expired."), { status: 400 });
  const had = JSON.parse((await identityDb.prepare("SELECT totp_recovery FROM accounts WHERE id = ?").get(staff.id))?.totp_recovery || "[]");
  const codes = had.length ? null : newRecoveryCodes();
  await identityDb.prepare("UPDATE accounts SET totp_enabled = 1, totp_recovery = ? WHERE id = ?").run(codes ? JSON.stringify(codes.map(hashCode)) : JSON.stringify(had), staff.id);
  return { recoveryCodes: codes, token: issue2faToken(staff.id) };
}

export async function verifyLogin(staff, code, method = "auto") {
  const r = await identityDb.prepare("SELECT totp_secret, totp_enabled, totp_recovery FROM accounts WHERE id = ?").get(staff.id);
  const clean = String(code || "").trim().toLowerCase();
  if (method === "email") { await verifyEmailCode(staff, clean); return issue2faToken(staff.id); }
  if (!r?.totp_enabled && !JSON.parse(r?.totp_recovery || "[]").length) throw Object.assign(new Error("No authenticator is set up. Use your email code or a security key."), { status: 400 });
  if (r?.totp_enabled && verifyTotp(unseal(r.totp_secret), clean)) return issue2faToken(staff.id);
  const list = JSON.parse(r.totp_recovery || "[]"), h = hashCode(clean);
  if (list.includes(h)) { // single-use recovery code
    await identityDb.prepare("UPDATE accounts SET totp_recovery = ? WHERE id = ?").run(JSON.stringify(list.filter((x) => x !== h)), staff.id);
    return issue2faToken(staff.id);
  }
  import("@/lib/security/core").then((m) => m.noteMfaFailure(staff.id)).catch(() => {});
  throw Object.assign(new Error("That code didn't work. Check that your phone's clock is set automatically, wait for the next code, and try again."), { status: 401 });
}
export async function resetTwoFactor(accountId) {
  await mfaTables();
  await identityDb.prepare("UPDATE accounts SET totp_secret=NULL, totp_enabled=0, totp_recovery=NULL WHERE id = ?").run(accountId);
  await identityDb.prepare("DELETE FROM staff_mfa_email WHERE account_id = ?").run(accountId);
  await identityDb.prepare("DELETE FROM sec_webauthn WHERE account_id = ?").run(accountId).catch(() => {});
}

// ---- Emailed one-time codes (a second option besides the authenticator app) ----
const hashOtp = (staffId, code) => hashCode(`${staffId}:${code}`);
export async function sendEmailCode(staff) {
  await mfaTables();
  const st = await twoFactorState(staff.id);
  if (!st.emailAllowed) throw Object.assign(new Error("Email codes are turned off for staff sign-in."), { status: 403 });
  if (!staff.email) throw Object.assign(new Error("Your account has no email address to send a code to."), { status: 400 });
  const row = await identityDb.prepare("SELECT last_sent FROM staff_mfa_email WHERE account_id = ?").get(staff.id);
  if (row?.last_sent && Date.now() - new Date(row.last_sent).getTime() < 30000) throw Object.assign(new Error("A code was just sent. Wait 30 seconds before asking for another."), { status: 429 });
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  const exp = new Date(Date.now() + 10 * 60000).toISOString(), now = new Date().toISOString();
  await identityDb.prepare("INSERT INTO staff_mfa_email (account_id, enabled, code_hash, expires_at, attempts, last_sent) VALUES (?,0,?,?,0,?) ON CONFLICT (account_id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, last_sent = excluded.last_sent")
    .run(staff.id, hashOtp(staff.id, code), exp, now);
  const { sendStaffLoginCodeEmail, isEmailConfigured } = await import("@/lib/email");
  if (!isEmailConfigured()) throw Object.assign(new Error("Email isn't configured on the server yet (RESEND_API_KEY and EMAIL_DOMAIN)."), { status: 503 });
  const r = await sendStaffLoginCodeEmail(staff.email, code);
  if (!r.sent) throw Object.assign(new Error("We couldn't send the email. Try again or use another method."), { status: 502 });
  return { sentTo: maskEmail(staff.email) };
}
async function verifyEmailCode(staff, code) {
  await mfaTables();
  const r = await identityDb.prepare("SELECT * FROM staff_mfa_email WHERE account_id = ?").get(staff.id);
  const fail = (m) => Object.assign(new Error(m), { status: 401 });
  if (!r?.code_hash || !r.expires_at) throw fail("Ask for a code first.");
  if (new Date(r.expires_at).getTime() < Date.now()) throw fail("That code expired. Ask for a new one.");
  if (r.attempts >= 5) throw fail("Too many wrong tries. Ask for a new code.");
  if (r.code_hash !== hashOtp(staff.id, code)) { await identityDb.prepare("UPDATE staff_mfa_email SET attempts = attempts + 1 WHERE account_id = ?").run(staff.id); import("@/lib/security/core").then((m) => m.noteMfaFailure(staff.id)).catch(() => {}); throw fail("That code isn't right."); }
  await identityDb.prepare("UPDATE staff_mfa_email SET code_hash = NULL, expires_at = NULL, attempts = 0 WHERE account_id = ?").run(staff.id); // single use
}
// First use of the email method proves the address works, and turns it on.
export async function confirmEmailEnrol(staff, code) {
  await verifyEmailCode(staff, String(code || "").trim());
  await identityDb.prepare("UPDATE staff_mfa_email SET enabled = 1 WHERE account_id = ?").run(staff.id);
  const had = JSON.parse((await identityDb.prepare("SELECT totp_recovery FROM accounts WHERE id = ?").get(staff.id))?.totp_recovery || "[]");
  let codes = null;
  if (!had.length) { codes = newRecoveryCodes(); await identityDb.prepare("UPDATE accounts SET totp_recovery = ? WHERE id = ?").run(JSON.stringify(codes.map(hashCode)), staff.id); }
  return { recoveryCodes: codes, token: issue2faToken(staff.id) };
}
export async function disableEmailMethod(staff) { await mfaTables(); await identityDb.prepare("UPDATE staff_mfa_email SET enabled = 0 WHERE account_id = ?").run(staff.id); return { ok: true }; }
