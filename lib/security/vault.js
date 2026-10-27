// Secrets vault + field encryption. AES-256-GCM, a fresh random IV per value, key from SECRETS_MASTER_KEY
// (base64, 32 bytes: `openssl rand -base64 32`). Without it a key is derived from IDENTITY_SIGNING_SECRET so
// nothing breaks, but set a dedicated key in production so rotating one secret never touches the other.
// PAM: revealing a stored secret needs a written reason, is time-stamped, and is audited (sec_vault_access).
import crypto from "node:crypto";
import { identityDb } from "@/lib/identity/db";

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
let ready = null;
async function init() {
  if (!ready) ready = identityDb.exec(`
    CREATE TABLE IF NOT EXISTS sec_vault (name TEXT PRIMARY KEY, ciphertext TEXT NOT NULL, note TEXT, created_by TEXT, created_at TEXT NOT NULL, rotated_at TEXT);
    CREATE TABLE IF NOT EXISTS sec_vault_access (id TEXT PRIMARY KEY, name TEXT NOT NULL, staff_id TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL);`).catch((e) => { ready = null; throw e; });
  return ready;
}
function key() {
  const k = process.env.SECRETS_MASTER_KEY;
  if (k) { const b = Buffer.from(k, "base64"); if (b.length === 32) return b; }
  return crypto.createHash("sha256").update(`lo-vault|${process.env.IDENTITY_SIGNING_SECRET || "dev-only-insecure-secret-change-me"}`).digest();
}
export const vaultUsesDedicatedKey = () => { try { return Buffer.from(process.env.SECRETS_MASTER_KEY || "", "base64").length === 32; } catch { return false; } };
export function encryptField(plain) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${enc.toString("base64url")}`;
}
export function decryptField(blob) {
  const [v, iv, tag, enc] = String(blob).split(".");
  if (v !== "v1") throw bad("Unknown ciphertext format.");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url")); d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
}
// Server-side read (no human involved): e.g. the SIEM webhook token. Falls back to an environment variable.
export async function vaultGet(name, envFallback) {
  try { await init(); const r = await identityDb.prepare("SELECT ciphertext FROM sec_vault WHERE name = ?").get(name); if (r) return decryptField(r.ciphertext); } catch {}
  return envFallback ? process.env[envFallback] || null : null;
}
export async function vaultPut(staff, { name, value, note }) {
  await init();
  if (!/^[A-Za-z][A-Za-z0-9_.-]{1,60}$/.test(name || "")) throw bad("Name: letters, numbers, . _ - (2–61 chars).");
  if (!value) throw bad("A value is required.");
  const had = await identityDb.prepare("SELECT 1 x FROM sec_vault WHERE name = ?").get(name);
  const now = new Date().toISOString();
  await identityDb.prepare("INSERT INTO sec_vault (name, ciphertext, note, created_by, created_at, rotated_at) VALUES (?,?,?,?,?,?) ON CONFLICT (name) DO UPDATE SET ciphertext = excluded.ciphertext, note = COALESCE(excluded.note, sec_vault.note), rotated_at = excluded.created_at")
    .run(name, encryptField(value), note ? String(note).slice(0, 160) : null, staff.id, now, had ? now : null);
  return { ok: true, rotated: !!had };
}
export async function vaultList() {
  await init();
  return (await identityDb.prepare("SELECT name, note, created_at, rotated_at FROM sec_vault ORDER BY name").all()).map((r) => ({ name: r.name, note: r.note, createdAt: r.created_at, rotatedAt: r.rotated_at }));
}
export async function vaultReveal(staff, name, reason) {
  await init();
  if (!reason || reason.trim().length < 8) throw bad("Give a reason (at least a short sentence). It is recorded.");
  const r = await identityDb.prepare("SELECT ciphertext FROM sec_vault WHERE name = ?").get(name);
  if (!r) throw bad("No such secret.", 404);
  await identityDb.prepare("INSERT INTO sec_vault_access (id, name, staff_id, reason, created_at) VALUES (?,?,?,?,?)").run(crypto.randomUUID(), name, staff.id, reason.slice(0, 300), new Date().toISOString());
  return { value: decryptField(r.ciphertext) };
}
export async function vaultDelete(name) { await init(); await identityDb.prepare("DELETE FROM sec_vault WHERE name = ?").run(name); return { ok: true }; }
export async function vaultAccessLog() { await init(); return (await identityDb.prepare("SELECT name, staff_id, reason, created_at FROM sec_vault_access ORDER BY created_at DESC LIMIT 30").all()); }
