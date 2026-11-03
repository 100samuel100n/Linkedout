// RFC 6238 TOTP (Google Authenticator / 1Password / Authy compatible) using
// only node:crypto — no dependency. Secrets are stored encrypted at rest with
// a key derived from IDENTITY_SIGNING_SECRET.
import crypto from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function newSecret() {
  const b = crypto.randomBytes(20); let bits = "", out = "";
  for (const x of b) bits += x.toString(2).padStart(8, "0");
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}
function b32decode(s) {
  let bits = ""; for (const c of s.replace(/=+$/, "")) bits += B32.indexOf(c).toString(2).padStart(5, "0");
  const bytes = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function code(secret, counter) {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", b32decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, "0");
}
// ±1 step (30 s) of clock drift allowed.
export function verifyTotp(secret, input) {
  const c = String(input || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  const step = Math.floor(Date.now() / 30000);
  return [-1, 0, 1].some((d) => crypto.timingSafeEqual(Buffer.from(code(secret, step + d)), Buffer.from(c)));
}
export const otpauthUri = (secret, label, issuer = "LinkedOut Admin") => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;

const key = () => crypto.createHash("sha256").update(process.env.IDENTITY_SIGNING_SECRET || "dev-only-insecure-secret-change-me").digest();
export function seal(text) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}
export function unseal(blob) {
  const [iv, tag, enc] = blob.split(".").map((x) => Buffer.from(x, "base64url"));
  const d = crypto.createDecipheriv("aes-256-gcm", key(), iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}
export const newRecoveryCodes = () => Array.from({ length: 8 }, () => crypto.randomBytes(5).toString("hex"));
export const hashCode = (c) => crypto.createHash("sha256").update(c).digest("hex");
