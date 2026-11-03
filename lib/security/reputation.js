// IP reputation score 0-100 (higher = worse). Sources: your own alert/rule history (always), the public Tor exit
// list (no key), and AbuseIPDB when ABUSEIPDB_KEY is set (free tier works). Results are cached 24 h.
import { identityDb } from "@/lib/identity/db";
let torSet = null, torAt = 0, ready = null;
async function init() { if (!ready) ready = identityDb.exec("CREATE TABLE IF NOT EXISTS sec_ip_rep (ip TEXT PRIMARY KEY, score INTEGER NOT NULL, reasons TEXT NOT NULL, checked_at TEXT NOT NULL)").catch((e) => { ready = null; throw e; }); return ready; }
async function torExit(ip) {
  try {
    if (!torSet || Date.now() - torAt > 6 * 3600000) {
      const r = await fetch("https://check.torproject.org/torbulkexitlist", { signal: AbortSignal.timeout(4000) });
      if (r.ok) { torSet = new Set((await r.text()).split("\n").map((x) => x.trim()).filter(Boolean)); torAt = Date.now(); }
    }
  } catch { /* keep the old list */ }
  return !!torSet?.has(ip);
}
export async function ipReputation(ip, { fresh = false } = {}) {
  if (!ip) return { score: 0, reasons: [], source: "none" };
  await init();
  if (!fresh) { const c = await identityDb.prepare("SELECT * FROM sec_ip_rep WHERE ip = ? AND checked_at > ?").get(ip, new Date(Date.now() - 86400000).toISOString()); if (c) return { score: c.score, reasons: JSON.parse(c.reasons), source: "cache" }; }
  let score = 0; const reasons = [];
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const a = await identityDb.prepare("SELECT severity, COUNT(*) c FROM sec_alerts WHERE ip = ? AND created_at > ? GROUP BY severity").all(ip, since);
  for (const r of a) { const w = { low: 3, medium: 12, high: 30, critical: 55 }[r.severity] || 0; score += Math.min(60, w * +r.c); reasons.push(`${r.c} ${r.severity} alert(s) in 30 days from this IP`); }
  if (await torExit(ip)) { score += 35; reasons.push("Tor exit node"); }
  const key = process.env.ABUSEIPDB_KEY;
  if (key) {
    try {
      const r = await fetch(`https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(ip)}&maxAgeInDays=60`, { headers: { Key: key, Accept: "application/json" }, signal: AbortSignal.timeout(4000) });
      if (r.ok) { const d = (await r.json()).data; if (d?.abuseConfidenceScore) { score += Math.round(d.abuseConfidenceScore * 0.7); reasons.push(`AbuseIPDB confidence ${d.abuseConfidenceScore}% (${d.totalReports} reports)`); } }
    } catch { /* optional source */ }
  }
  score = Math.min(100, score);
  await identityDb.prepare("INSERT INTO sec_ip_rep (ip, score, reasons, checked_at) VALUES (?,?,?,?) ON CONFLICT (ip) DO UPDATE SET score = excluded.score, reasons = excluded.reasons, checked_at = excluded.checked_at").run(ip, score, JSON.stringify(reasons), new Date().toISOString());
  return { score, reasons, source: key ? "internal+tor+abuseipdb" : "internal+tor" };
}
export const reputationSources = () => ({ internal: true, tor: true, abuseipdb: !!process.env.ABUSEIPDB_KEY });
