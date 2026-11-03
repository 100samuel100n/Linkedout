// Pure helpers (no database, no framework) so they can be unit-tested with plain `node`.
import crypto from "node:crypto";

// Canonical JSON: object keys sorted recursively, no whitespace, UTF-8. This is the exact byte string that is signed,
// so anyone can re-create it in any language: sort keys, JSON-encode, no spaces.
export function canonicalJson(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  return "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(v[k])).join(",") + "}";
}
export const sha256Hex = (data) => crypto.createHash("sha256").update(data).digest("hex");
export const b64u = (buf) => Buffer.from(buf).toString("base64url");
export const fromB64u = (s) => Buffer.from(String(s || ""), "base64url");
export const fromB64 = (s) => Buffer.from(String(s || ""), "base64");
export const normHex = (s) => String(s || "").replace(/[^0-9a-fA-F]/g, "").toUpperCase();
// "AB:CD:…" style used by keytool/apksigner output.
export const colonHex = (hex) => normHex(hex).match(/.{1,2}/g)?.join(":") || "";
export const timingEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
