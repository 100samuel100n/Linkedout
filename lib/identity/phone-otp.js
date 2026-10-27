// Phone verification, built in-house.
//
//   request  -> generate a random 6-digit code, store a keyed hash of it with
//               an expiry, text the plain code through Telnyx (lib/sms.js)
//   confirm  -> compare against the stored hash, enforce expiry + attempts
//   cleanup  -> rows are deleted on success, on expiry, and on too many
//               wrong guesses; expired rows are also swept on every request
//
// Fraud prevention (SMS pumping is the main way phone verification loses
// money, so every rule here is checked BEFORE a message is sent):
//   1. strict E.164 validation + optional country allow/deny lists
//   2. account must have a verified email (blocks throwaway signups)
//   3. resend cooldown, and hourly/daily caps per account, per phone number,
//      per IP address
//   4. per-country-prefix and global hourly volume ceilings (a sudden flood
//      to one prefix trips a breaker before it turns into a bill)
//   5. one verified phone per account, one account per verified phone
//   6. codes are single-use, 5 guesses max, constant-time compared, and a
//      new request invalidates the previous code
//   7. only hashes of phone/IP are kept in the abuse ledger (sms_events)
import crypto from "node:crypto";
import { identityDb } from "./db.js";
import { sendVerificationSms, isSmsConfigured } from "../sms.js";
import { checkAndAwardBadges } from "./service.js";

const TTL_MS = Math.max(1, Number(process.env.OTP_TTL_MINUTES || 10)) * 60 * 1000;
const MAX_GUESSES = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;

const LIMITS = {
  perAccountHour: 3, perAccountDay: 6,
  perPhoneHour: 3, perPhoneDay: 5,
  perIpHour: 6, perIpDay: 15,
  perPrefixHour: Number(process.env.SMS_PREFIX_HOURLY_CAP || 40),
  globalHour: Number(process.env.SMS_GLOBAL_HOURLY_CAP || 300),
  verifyPerAccountHour: 15,
};
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export class PhoneOtpError extends Error {
  constructor(code, message, status = 400, extra = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

function pepper() {
  return process.env.IDENTITY_SIGNING_SECRET || "dev-only-pepper";
}
const hmac = (label, value) => crypto.createHmac("sha256", pepper()).update(`${label}:${value}`).digest("hex");

// ---- helpers ----
export function normalizePhone(input) {
  const raw = String(input || "").trim().replace(/[\s().-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(raw)) return null;
  return raw;
}

// Country calling-code prefix used for volume breakers and allow/deny
// lists: the 1-3 leading digits. NANP (+1) numbers share one prefix.
function prefixOf(phone) {
  const d = phone.slice(1);
  const c0 = d[0], c1 = d[1];
  if (c0 === "1" || c0 === "7") return c0;
  let len = 3;
  if (c0 === "2") len = d.startsWith("20") || d.startsWith("27") ? 2 : 3;
  else if (c0 === "3") len = "0123469".includes(c1) ? 2 : 3;
  else if (c0 === "4") len = c1 === "2" ? 3 : 2;
  else if (c0 === "5") len = "09".includes(c1) ? 3 : 2;
  else if (c0 === "6") len = "0123456".includes(c1) ? 2 : 3;
  else if (c0 === "8") len = "1246".includes(c1) ? 2 : 3;
  else if (c0 === "9") len = "0123458".includes(c1) ? 2 : 3;
  return d.slice(0, len);
}

function listFromEnv(name) {
  return (process.env[name] || "").split(",").map((s) => s.trim().replace(/^\+/, "")).filter(Boolean);
}

async function purgeExpired() {
  const now = new Date().toISOString();
  await identityDb.prepare("DELETE FROM phone_otps WHERE expires_at < ?").run(now);
  // The abuse ledger only needs to look back a day for the rules above.
  await identityDb.prepare("DELETE FROM sms_events WHERE created_at < ?").run(new Date(Date.now() - 3 * DAY).toISOString());
}

async function countEvents(column, value, sinceMs, kind = "request") {
  const since = new Date(Date.now() - sinceMs).toISOString();
  const row = await identityDb.prepare(
    `SELECT COUNT(*) AS n FROM sms_events WHERE ${column} = ? AND kind = ? AND outcome IN ('sent','failed') AND created_at > ?`
  ).get(value, kind, since);
  return Number(row.n);
}

async function logEvent({ accountId, phoneHash, ipHash, prefix, kind, outcome }) {
  await identityDb.prepare(
    "INSERT INTO sms_events (id, account_id, phone_hash, ip_hash, country_prefix, kind, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(crypto.randomUUID(), accountId || null, phoneHash || null, ipHash || null, prefix || null, kind, outcome, new Date().toISOString());
}

// ---- request a code ----
export async function requestPhoneCode({ accountId, phone: rawPhone, ip }) {
  if (!isSmsConfigured()) {
    throw new PhoneOtpError("SMS_UNAVAILABLE", "Phone verification is temporarily unavailable. Please try again later.", 503);
  }
  await purgeExpired();

  const phone = normalizePhone(rawPhone);
  if (!phone) throw new PhoneOtpError("INVALID_PHONE", "Enter your number in international format, like +254712345678.");

  const prefix = prefixOf(phone);
  const allow = listFromEnv("SMS_ALLOWED_COUNTRY_CODES");
  const deny = listFromEnv("SMS_BLOCKED_COUNTRY_CODES");
  if ((allow.length && !allow.includes(prefix)) || deny.includes(prefix)) {
    throw new PhoneOtpError("COUNTRY_NOT_SUPPORTED", "We can't send verification codes to that country right now.");
  }

  const account = await identityDb.prepare("SELECT id, email_verified, phone, phone_verified FROM accounts WHERE id = ?").get(accountId);
  if (!account) throw new PhoneOtpError("NO_ACCOUNT", "Account not found.", 404);
  if (process.env.SMS_REQUIRE_VERIFIED_EMAIL !== "false" && !account.email_verified) {
    throw new PhoneOtpError("EMAIL_FIRST", "Verify your email address first, then add your phone.", 403);
  }
  if (account.phone_verified && account.phone === phone) {
    throw new PhoneOtpError("ALREADY_VERIFIED", "That number is already verified on your account.");
  }

  // One account per verified number. Same wording as a bad number so this
  // can't be used to probe which phone numbers are registered.
  const taken = await identityDb.prepare("SELECT id FROM accounts WHERE phone = ? AND phone_verified = 1 AND id != ?").get(phone, accountId);
  if (taken) throw new PhoneOtpError("PHONE_UNAVAILABLE", "That number can't be used. Try a different one.");

  const phoneHash = hmac("phone", phone);
  const ipHash = ip ? hmac("ip", ip) : null;
  const ctx = { accountId, phoneHash, ipHash, prefix, kind: "request" };

  // Resend cooldown against this account's last code.
  const last = await identityDb.prepare("SELECT created_at FROM phone_otps WHERE account_id = ? ORDER BY created_at DESC LIMIT 1").get(accountId);
  if (last) {
    const wait = new Date(last.created_at).getTime() + RESEND_COOLDOWN_MS - Date.now();
    if (wait > 0) throw new PhoneOtpError("COOLDOWN", `Wait ${Math.ceil(wait / 1000)}s before requesting another code.`, 429, { retryAfterSec: Math.ceil(wait / 1000) });
  }

  const rules = [
    ["account_id", accountId, HOUR, LIMITS.perAccountHour, "Too many codes requested. Try again in an hour."],
    ["account_id", accountId, DAY, LIMITS.perAccountDay, "Daily code limit reached. Try again tomorrow."],
    ["phone_hash", phoneHash, HOUR, LIMITS.perPhoneHour, "Too many codes sent to that number. Try again later."],
    ["phone_hash", phoneHash, DAY, LIMITS.perPhoneDay, "Too many codes sent to that number today."],
    ...(ipHash ? [
      ["ip_hash", ipHash, HOUR, LIMITS.perIpHour, "Too many requests from your network. Try again later."],
      ["ip_hash", ipHash, DAY, LIMITS.perIpDay, "Too many requests from your network today."],
    ] : []),
  ];
  for (const [col, val, win, max, message] of rules) {
    if ((await countEvents(col, val, win)) >= max) {
      await logEvent({ ...ctx, outcome: "blocked" });
      throw new PhoneOtpError("RATE_LIMITED", message, 429);
    }
  }
  // Volume breakers: protect the SMS bill even if every per-user rule holds.
  if ((await countEvents("country_prefix", prefix, HOUR)) >= LIMITS.perPrefixHour ||
      (await identityDb.prepare("SELECT COUNT(*) AS n FROM sms_events WHERE kind = 'request' AND outcome IN ('sent','failed') AND created_at > ?")
        .get(new Date(Date.now() - HOUR).toISOString()).then((r) => Number(r.n))) >= LIMITS.globalHour) {
    await logEvent({ ...ctx, outcome: "blocked" });
    console.error(`[sms] volume breaker tripped (prefix +${prefix}) — investigate for SMS pumping.`);
    throw new PhoneOtpError("BUSY", "Verification is busy right now. Please try again in a little while.", 503);
  }

  // Generate, replace any earlier code, store only the hash.
  const code = String(crypto.randomInt(100000, 1000000));
  const now = Date.now();
  const id = crypto.randomUUID();
  await identityDb.prepare("DELETE FROM phone_otps WHERE account_id = ?").run(accountId);
  await identityDb.prepare(
    "INSERT INTO phone_otps (id, account_id, phone, code_hash, attempts, created_at, expires_at) VALUES (?, ?, ?, ?, 0, ?, ?)"
  ).run(id, accountId, phone, hmac(`otp:${id}`, code), new Date(now).toISOString(), new Date(now + TTL_MS).toISOString());

  const result = await sendVerificationSms(phone, code);
  if (!result.sent) {
    await identityDb.prepare("DELETE FROM phone_otps WHERE id = ?").run(id);
    await logEvent({ ...ctx, outcome: "failed" });
    throw new PhoneOtpError("SEND_FAILED", "We couldn't send the text. Check the number and try again.", 502);
  }
  await logEvent({ ...ctx, outcome: "sent" });
  return { expiresInSec: Math.round(TTL_MS / 1000), resendInSec: RESEND_COOLDOWN_MS / 1000 };
}

// ---- confirm a code ----
export async function confirmPhoneCode({ accountId, code: rawCode, ip }) {
  await purgeExpired();
  const code = String(rawCode || "").trim();
  if (!/^\d{6}$/.test(code)) throw new PhoneOtpError("BAD_FORMAT", "Enter the 6-digit code.");

  const ipHash = ip ? hmac("ip", ip) : null;
  const since = new Date(Date.now() - HOUR).toISOString();
  const attemptsRow = await identityDb.prepare(
    "SELECT COUNT(*) AS n FROM sms_events WHERE account_id = ? AND kind = 'verify' AND created_at > ?"
  ).get(accountId, since);
  if (Number(attemptsRow.n) >= LIMITS.verifyPerAccountHour) {
    throw new PhoneOtpError("RATE_LIMITED", "Too many attempts. Try again in an hour.", 429);
  }

  const row = await identityDb.prepare("SELECT * FROM phone_otps WHERE account_id = ? ORDER BY created_at DESC LIMIT 1").get(accountId);
  if (!row) throw new PhoneOtpError("NO_PENDING", "That code expired or was never requested. Request a new one.");

  await logEvent({ accountId, ipHash, phoneHash: hmac("phone", row.phone), kind: "verify", outcome: "attempt" });

  const expected = Buffer.from(hmac(`otp:${row.id}`, code), "hex");
  const actual = Buffer.from(row.code_hash, "hex");
  const ok = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

  if (!ok) {
    const attempts = row.attempts + 1;
    if (attempts >= MAX_GUESSES) {
      await identityDb.prepare("DELETE FROM phone_otps WHERE id = ?").run(row.id);
      throw new PhoneOtpError("TOO_MANY_ATTEMPTS", "Too many wrong codes. Request a new one.", 429);
    }
    await identityDb.prepare("UPDATE phone_otps SET attempts = ? WHERE id = ?").run(attempts, row.id);
    throw new PhoneOtpError("WRONG_CODE", `Incorrect code. ${MAX_GUESSES - attempts} attempt${MAX_GUESSES - attempts === 1 ? "" : "s"} left.`);
  }

  // Success: consume the code first (single use), then bind the number.
  await identityDb.prepare("DELETE FROM phone_otps WHERE account_id = ?").run(accountId);
  try {
    await identityDb.prepare("UPDATE accounts SET phone = ?, phone_verified = 1 WHERE id = ?").run(row.phone, accountId);
  } catch (e) {
    if (e.code === "23505") throw new PhoneOtpError("PHONE_UNAVAILABLE", "That number can't be used. Try a different one.");
    throw e;
  }
  await checkAndAwardBadges(accountId);
  return { ok: true };
}
