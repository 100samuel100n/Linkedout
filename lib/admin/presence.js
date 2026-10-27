// Live presence for the admin dashboard.
// The website and the app send a heartbeat every ~30 seconds while someone is actually looking at
// them (tab visible / app in the foreground). Anyone seen in the last 90 seconds (three missed-beat
// grace: one heartbeat can be dropped or delayed without the person flickering offline) counts as online now.
import { identityDb } from "@/lib/identity/db";
import { recordActivity } from "./enforce.js";
import { countryName } from "../geo.js";

export const ONLINE_WINDOW_MS = 90 * 1000;
const PLATFORMS = new Set(["web", "app"]);
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();

export async function heartbeat(accountId, { platform, geo }) {
  const p = PLATFORMS.has(platform) ? platform : "web";
  const now = iso();
  recordActivity(accountId);
  // `since` is when this stretch of activity began: it resets if they were away for over two minutes.
  await identityDb.prepare(
    `INSERT INTO presence (account_id, platform, last_seen_at, country, city, since) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (account_id, platform) DO UPDATE SET
       since = CASE WHEN presence.last_seen_at < ? THEN EXCLUDED.since ELSE COALESCE(presence.since, EXCLUDED.since) END,
       last_seen_at = EXCLUDED.last_seen_at, country = COALESCE(EXCLUDED.country, presence.country), city = COALESCE(EXCLUDED.city, presence.city)`
  ).run(accountId, p, now, geo?.country || null, geo?.city || null, now, iso(2 * 60000));
}

export async function goOffline(accountId, platform) {
  await identityDb.prepare("DELETE FROM presence WHERE account_id = ? AND platform = ?").run(accountId, PLATFORMS.has(platform) ? platform : "web").catch(() => {});
}

// Everything the "Live now" panel shows, in one cheap query.
export async function liveSnapshot() {
  const rows = await identityDb.prepare(
    `SELECT p.account_id, p.platform, p.last_seen_at, p.country, p.city, p.since, a.pseudonym, a.role, a.premium_tier
     FROM presence p JOIN accounts a ON a.id = p.account_id
     WHERE p.last_seen_at >= ? AND a.status NOT IN ('banned', 'suspended') ORDER BY p.since ASC`
  ).all(iso(ONLINE_WINDOW_MS));
  const byAccount = new Map();
  for (const r of rows) {
    const o = byAccount.get(r.account_id) || { id: r.account_id, pseudonym: r.pseudonym, role: r.role, tier: r.premium_tier, platforms: [], country: null, city: null, since: r.since, lastSeenAt: r.last_seen_at };
    o.platforms.push(r.platform);
    o.country = o.country || r.country; o.city = o.city || r.city;
    if (r.since && r.since < o.since) o.since = r.since;
    if (r.last_seen_at > o.lastSeenAt) o.lastSeenAt = r.last_seen_at;
    byAccount.set(r.account_id, o);
  }
  const users = [...byAccount.values()];
  const countries = new Map();
  for (const u of users) { const k = u.country || "??"; countries.set(k, (countries.get(k) || 0) + 1); }
  const [peak] = await Promise.all([
    identityDb.prepare("SELECT COUNT(DISTINCT p.account_id) AS n FROM presence p JOIN accounts a ON a.id = p.account_id WHERE p.last_seen_at >= ? AND a.status NOT IN ('banned', 'suspended')").get(iso(5 * 60000)).catch(() => ({ n: 0 })),
  ]);
  return {
    at: iso(),
    windowSec: ONLINE_WINDOW_MS / 1000,
    total: users.length,
    web: users.filter((u) => u.platforms.includes("web")).length,
    app: users.filter((u) => u.platforms.includes("app")).length,
    last5min: Number(peak?.n || 0),
    countries: [...countries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([code, n]) => ({ code, name: code === "??" ? "Unknown" : countryName(code) || code, n })),
    users: users.sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1)).slice(0, 100).map((u) => ({ ...u, platforms: [...new Set(u.platforms)] })),
  };
}

// Users whose most recent heartbeat is recent: lets the user list show a pulsing dot per person.
export async function onlineIds(ids) {
  if (!ids.length) return new Set();
  const rows = await identityDb.prepare(`SELECT DISTINCT account_id FROM presence WHERE last_seen_at >= ? AND account_id = ANY(?)`).all(iso(ONLINE_WINDOW_MS), ids).catch(() => []);
  return new Set(rows.map((r) => r.account_id));
}
