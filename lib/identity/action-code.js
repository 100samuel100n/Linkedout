// Email confirmation codes for destructive account actions (deactivate, delete).
//
// Everyone gets this check, with or without two-factor: a code goes to the address on the
// account (the Google address for accounts created with Google, the sign-up address otherwise),
// so a stolen session or an unlocked phone is not enough to remove an account.
import crypto from "node:crypto";
import { identityDb } from "./db.js";
import { checkRateLimit } from "./rate-limit.js";
import { sendAccountActionCodeEmail } from "../email.js";

const PURPOSES = new Set(["deactivate", "delete"]);
const TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const SECRET = process.env.IDENTITY_SIGNING_SECRET || "dev-only-insecure-secret-change-me";

const hash = (accountId, purpose, code) =>
  crypto.createHmac("sha256", SECRET).update(`${accountId}:${purpose}:${code}`).digest("hex");

export function maskEmail(email) {
  const [name = "", domain = ""] = String(email || "").split("@");
  if (!domain) return "your email";
  return `${name.slice(0, 2)}${"*".repeat(Math.max(1, Math.min(name.length - 2, 6)))}@${domain}`;
}

// Sends a fresh code (replacing any earlier unused one). Returns the masked address it went to.
export async function sendActionCode(account, purpose) {
  if (!PURPOSES.has(purpose)) throw new Error("Unknown action");
  if (!account?.email) {
    const err = new Error("There's no email address on this account, so we can't send a confirmation code. Contact support.");
    err.status = 400; throw err;
  }
  await checkRateLimit(account.id, "action_code");
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  const now = Date.now();
  await identityDb.prepare("DELETE FROM account_action_codes WHERE account_id = ? AND purpose = ?").run(account.id, purpose);
  await identityDb.prepare(
    "INSERT INTO account_action_codes (id, account_id, purpose, code_hash, attempts, created_at, expires_at) VALUES (?, ?, ?, ?, 0, ?, ?)"
  ).run(crypto.randomUUID(), account.id, purpose, hash(account.id, purpose, code), new Date(now).toISOString(), new Date(now + TTL_MS).toISOString());
  await sendAccountActionCodeEmail(account.email, code, purpose, TTL_MS / 60000);
  return { sentTo: maskEmail(account.email), expiresInMinutes: TTL_MS / 60000 };
}

// Returns null when the code is right (and burns it), or a { status, code, error } for the route to send.
export async function checkActionCode(accountId, purpose, input) {
  const code = String(input || "").replace(/\D/g, "");
  if (code.length !== 6) return { status: 400, code: "EMAIL_CODE_REQUIRED", error: "Enter the 6-digit code we emailed you." };
  const row = await identityDb.prepare("SELECT * FROM account_action_codes WHERE account_id = ? AND purpose = ?").get(accountId, purpose);
  if (!row || new Date(row.expires_at).getTime() < Date.now()) {
    return { status: 400, code: "EMAIL_CODE_EXPIRED", error: "That code has expired. Request a new one." };
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    await identityDb.prepare("DELETE FROM account_action_codes WHERE id = ?").run(row.id);
    return { status: 429, code: "EMAIL_CODE_LOCKED", error: "Too many wrong attempts. Request a new code." };
  }
  const a = Buffer.from(hash(accountId, purpose, code)); const b = Buffer.from(row.code_hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    await identityDb.prepare("UPDATE account_action_codes SET attempts = attempts + 1 WHERE id = ?").run(row.id);
    return { status: 400, code: "EMAIL_CODE_INVALID", error: "That code isn't right. Check the email and try again." };
  }
  await identityDb.prepare("DELETE FROM account_action_codes WHERE id = ?").run(row.id);
  return null;
}
