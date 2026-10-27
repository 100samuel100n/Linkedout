// Server-side duplicate-submit guard. A second identical request from the same
// account inside the window is refused, so a double click, a retry or a flaky
// network can never publish the same thing twice. In-memory per instance; the
// stories path also checks the database, which covers multi-instance hosts.
const seen = new Map();
export function claimOnce(key, ttlMs = 20000) {
  const now = Date.now();
  if (seen.size > 5000) for (const [k, t] of seen) if (t < now) seen.delete(k);
  const until = seen.get(key);
  if (until && until > now) return false;
  seen.set(key, now + ttlMs);
  return true;
}
export function releaseClaim(key) { seen.delete(key); }
export async function fingerprint(...parts) {
  const data = new TextEncoder().encode(parts.map((p) => String(p ?? "")).join("\u0000"));
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}
