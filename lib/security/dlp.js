// DLP fingerprinting: every export is stamped with a per-download id that is registered to the account. If content
// leaks, paste it into Security Operations → Access → "Trace leaked content" to find who downloaded it.
// JSON gets a `_fp` field; plain text gets the id encoded invisibly in zero-width characters (survives copy/paste).
import crypto from "node:crypto";
import { identityDb } from "@/lib/identity/db";
let ready = null;
async function init() { if (!ready) ready = identityDb.exec("CREATE TABLE IF NOT EXISTS sec_fingerprints (fp TEXT PRIMARY KEY, account_id TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL)").catch((e) => { ready = null; throw e; }); return ready; }
const ZW = ["\u200b", "\u200c", "\u200d", "\u2060"]; // 2 bits per character
const encode = (hex) => [...Buffer.from(hex, "hex")].map((b) => [6, 4, 2, 0].map((s) => ZW[(b >> s) & 3]).join("")).join("");
function decode(text) {
  const chars = [...text].filter((c) => ZW.includes(c)); const out = [];
  for (let i = 0; i + 3 < chars.length; i += 4) out.push(chars.slice(i, i + 4).reduce((a, c) => (a << 2) | ZW.indexOf(c), 0));
  return Buffer.from(out).toString("hex");
}
export async function stamp(accountId, kind, payload) {
  await init();
  const fp = crypto.randomBytes(6).toString("hex");
  await identityDb.prepare("INSERT INTO sec_fingerprints (fp, account_id, kind, created_at) VALUES (?,?,?,?)").run(fp, accountId, kind, new Date().toISOString());
  if (typeof payload === "string") return payload.replace(/(\s)/, `$1${encode(fp)}`);
  return { ...payload, _fp: fp };
}
export async function trace(text) {
  await init();
  const found = new Set();
  for (const m of String(text).matchAll(/"_fp"\s*:\s*"([0-9a-f]{12})"/g)) found.add(m[1]);
  const zw = decode(String(text)); for (let i = 0; i + 12 <= zw.length; i += 12) found.add(zw.slice(i, i + 12));
  const out = [];
  for (const fp of found) { const r = await identityDb.prepare("SELECT f.*, a.pseudonym FROM sec_fingerprints f LEFT JOIN accounts a ON a.id = f.account_id WHERE f.fp = ?").get(fp); if (r) out.push({ fp, accountId: r.account_id, who: r.pseudonym, kind: r.kind, at: r.created_at }); }
  return out;
}
