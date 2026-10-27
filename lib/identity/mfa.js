// Two-factor authentication for ALL accounts (TOTP — Google Authenticator,
// 1Password, Authy…). Same secret columns the staff admin gate uses, so a user
// who turns it on in Settings also satisfies the admin 2FA prompt with it.
import { identityDb } from "./db.js";
import { signToken, verifyToken } from "./crypto.js";
import { getAccountById, verifyCredentials } from "./service.js";
import { seal, unseal, verifyTotp, newSecret, otpauthUri, newRecoveryCodes, hashCode } from "../admin/totp.js";

const err = (m, status = 400) => Object.assign(new Error(m), { status });

export async function mfaEnabled(accountId) {
  const r = await identityDb.prepare("SELECT totp_enabled FROM accounts WHERE id = ?").get(accountId);
  return !!r?.totp_enabled;
}
export async function mfaStatus(accountId) {
  const r = await identityDb.prepare("SELECT totp_enabled, totp_recovery FROM accounts WHERE id = ?").get(accountId);
  return { enabled: !!r?.totp_enabled, recoveryLeft: r?.totp_enabled ? JSON.parse(r.totp_recovery || "[]").length : 0 };
}

export async function startSetup(accountId) {
  if (await mfaEnabled(accountId)) throw err("Two-factor is already on.");
  const a = await getAccountById(accountId);
  const secret = newSecret();
  await identityDb.prepare("UPDATE accounts SET totp_secret = ?, totp_enabled = 0 WHERE id = ?").run(seal(secret), accountId);
  return { secret, uri: otpauthUri(secret, a.email || a.pseudonym, "LinkedOut") };
}

export async function enable(accountId, code) {
  const r = await identityDb.prepare("SELECT totp_secret, totp_enabled FROM accounts WHERE id = ?").get(accountId);
  if (!r?.totp_secret) throw err("Start setup first.");
  if (r.totp_enabled) throw err("Two-factor is already on.");
  if (!verifyTotp(unseal(r.totp_secret), code)) throw err("That code is wrong or expired. Check your phone's clock and try again.");
  const codes = newRecoveryCodes();
  await identityDb.prepare("UPDATE accounts SET totp_enabled = 1, totp_recovery = ? WHERE id = ?").run(JSON.stringify(codes.map(hashCode)), accountId);
  return { recoveryCodes: codes };
}

// Accepts a 6-digit TOTP or a single-use recovery code.
export async function checkCode(accountId, input) {
  const r = await identityDb.prepare("SELECT totp_secret, totp_enabled, totp_recovery FROM accounts WHERE id = ?").get(accountId);
  if (!r?.totp_enabled) return false;
  const clean = String(input || "").trim().toLowerCase();
  if (verifyTotp(unseal(r.totp_secret), clean)) return true;
  const list = JSON.parse(r.totp_recovery || "[]"), h = hashCode(clean);
  if (!list.includes(h)) return false;
  await identityDb.prepare("UPDATE accounts SET totp_recovery = ? WHERE id = ?").run(JSON.stringify(list.filter((x) => x !== h)), accountId);
  return true;
}

export async function disable(accountId, password, code) {
  const a = await getAccountById(accountId);
  const row = await identityDb.prepare("SELECT password_hash FROM accounts WHERE id = ?").get(accountId);
  if (row?.password_hash) { // OAuth-only accounts have no password; the code alone is enough
    if (!password || !(await verifyCredentials(a.email, password))) throw err("Your password is incorrect.");
  }
  if (!(await checkCode(accountId, code))) throw err("That code is wrong or expired.");
  await identityDb.prepare("UPDATE accounts SET totp_secret = NULL, totp_enabled = 0, totp_recovery = NULL WHERE id = ?").run(accountId);
}

// ---- Sign-in step 2 ----
// Credentials (or Google/Apple) prove the first factor; if the account has 2FA
// we hand back a 5-minute challenge instead of a session. It is NOT a session
// token (different payload), so it can't be used for anything but this step.
export const makeChallenge = (accountId) => signToken({ t: "login2fa", a: accountId, exp: Date.now() + 5 * 60 * 1000 });
export function readChallenge(challenge) {
  const p = challenge && verifyToken(challenge);
  return p && p.t === "login2fa" ? p.a : null;
}
export async function challengeIfNeeded(accountId) {
  return (await mfaEnabled(accountId)) ? makeChallenge(accountId) : null;
}

// ---- Step-up check for sensitive actions ----
// Password change, deactivation, deletion (and similar) require a fresh code
// whenever the account has two-factor on. Accounts without 2FA pass straight
// through. Returns null when the action may proceed, or a { error, code, status }
// descriptor the route can send back so clients know to ask for a code.
export async function requireMfa(accountId, code) {
  if (!(await mfaEnabled(accountId))) return null;
  if (!code || !String(code).trim()) {
    return { status: 403, code: "MFA_REQUIRED", error: "Enter the 6-digit code from your authenticator app to continue." };
  }
  if (!(await checkCode(accountId, code))) {
    return { status: 403, code: "MFA_INVALID", error: "That code is wrong or expired. Try again." };
  }
  return null;
}
