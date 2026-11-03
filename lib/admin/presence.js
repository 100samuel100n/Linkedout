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

const ENSURE = `CREATE TABLE IF NOT EXISTS presence (account_id TEXT NOT NULL, platform TEXT NOT NULL, last_seen_at TEXT NOT NULL, country TEXT, city TEXT, since TEXT, PRIMARY KEY (account_id, platform))`;
let ensured = false;
async function ensureTable() { if (ensured) return; await identityDb.exec(ENSURE); ensured = true; }
let lastError = null;
export const presenceHealth = () => lastError;

export async function heartbeat(accountId, { platform, geo }) {
  const p = PLATFORMS.has(platform) ? platform : "web";
  const now = iso();
  try { recordActivity(accountId); } catch { /* activity bookkeeping must never block presence */ }
  try { await writeBeat(accountId, p, now, geo); lastError = null; }
  catch (e) {
    // The most likely cause is a missing table (a migration that never ran). Create it and try once more.
    try { ensured = false; await ensureTable(); await writeBeat(accountId, p, now, geo); lastError = null; }
    catch (e2) { lastError = { at: now, message: String(e2?.message || e2).slice(0, 300) }; console.error("[presence] heartbeat failed:", e2?.message || e2); throw e2; }
  }
}
async function writeBeat(accountId, p, now, geo) {
  // `since` is when this stretch of activity began: it resets if they were away for over two minutes.
  await identityDb.prepare(
    `INSERT INTO presence (account_id, platform, last_seen_at, country, city, since) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (account_id, platform) DO UPDATE SET
       since = CASE WHEN presence.last_seen_at < ? THEN EXCLUDED.since ELSE COALESCE(presence.since, EXCLUDED.since) END,
       last_seen_at = EXCLUDED.last_seen_at, country = COALESCE(EXCLUDED.country, presence.country), city = COALESCE(EXCLUDED.city, presence.city)`
  ).run(accountId, p, now, geo?.country || null, geo?.city || null, now, iso(2 * 60000));
}

// Any authenticated request from the native app proves the app is open, even if its separate "heartbeat" call did not land
// (blocked, older build, transient error). Without this such people showed up as "other". At most one write per account per 30 s.
const lastApp = new Map();
export function touchApp(accountId) {
  const t = Date.now(); if (t - (lastApp.get(accountId) || 0) < 30000) return; lastApp.set(accountId, t);
  if (lastApp.size > 20000) lastApp.clear();
  heartbeat(accountId, { platform: "app", geo: null }).catch(() => {});
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
  // Safety net: any signed-in request also stamps accounts.last_seen_at (see recordActivity). Someone who is clearly active
  // but whose heartbeat didn't land (blocked beacon, older app build, a transient error) still counts, shown as "other".
  const fb = await identityDb.prepare(
    `SELECT id, pseudonym, role, premium_tier, last_seen_at FROM accounts WHERE last_seen_at >= ? AND status NOT IN ('banned', 'suspended') ORDER BY last_seen_at DESC LIMIT 200`
  ).all(iso(ONLINE_WINDOW_MS + 60000)).catch(() => []);
  for (const a of fb) if (!byAccount.has(a.id)) byAccount.set(a.id, { id: a.id, pseudonym: a.pseudonym, role: a.role, tier: a.premium_tier, platforms: ["other"], country: null, city: null, since: a.last_seen_at, lastSeenAt: a.last_seen_at });
  const users = [...byAccount.values()];
  const diag = await identityDb.prepare("SELECT COUNT(*) AS n, MAX(last_seen_at) AS newest FROM presence").get().catch((e) => ({ n: -1, newest: null, error: String(e?.message || e).slice(0, 200) }));
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
    other: users.filter((u) => u.platforms.length === 1 && u.platforms[0] === "other").length,
    diagnostics: { heartbeatRows: Number(diag?.n ?? 0), newestHeartbeat: diag?.newest || null, tableError: diag?.error || null, lastWriteError: presenceHealth(), fromActivityOnly: fb.filter((a) => !rows.some((r) => r.account_id === a.id)).length },
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