// View metrics for EVERYTHING (posts, stories, companies, profiles, rooms, circles, comments, pulse items).
//
// Recorded from day one, shown later. Nothing in the UI reads these numbers yet, so launching "X-style" view
// counts a year from now will show the full history instead of starting at zero. The feature flag for showing
// them is `VIEW_COUNTS_VISIBLE` in lib/tiers.js-style settings (platform_settings key `views.visible`), off by default.
//
// Privacy: the content database never stores an account id. A viewer is a salted one-way hash. Two numbers are
// kept per item: `total` (every counted view, de-duplicated per viewer per 30 minutes so refresh-spam does not
// inflate it) and `uniques` (distinct viewers ever). Daily buckets keep the history for charts.
import crypto from "node:crypto";
import { contentDb } from "./content/db.js";

export const VIEW_KINDS = ["post", "story", "company", "profile", "room", "circle", "comment", "ad", "job"];
const SALT = process.env.VIEW_HASH_SALT || process.env.SESSION_SECRET || "lo-views";
const WINDOW_MS = 30 * 60 * 1000;
const day = (d = new Date()) => d.toISOString().slice(0, 10);
const hash = (s) => crypto.createHmac("sha256", SALT).update(String(s)).digest("hex").slice(0, 32);
const recent = new Map(); // in-process burst guard so a refresh storm does not even reach the database

export async function migrateViews(q) {
  await q(`CREATE TABLE IF NOT EXISTS view_counts (
    kind TEXT NOT NULL, item_id TEXT NOT NULL, total BIGINT NOT NULL DEFAULT 0, uniques BIGINT NOT NULL DEFAULT 0,
    first_at TEXT, last_at TEXT, PRIMARY KEY (kind, item_id))`);
  await q(`CREATE TABLE IF NOT EXISTS view_daily (
    kind TEXT NOT NULL, item_id TEXT NOT NULL, day TEXT NOT NULL, n BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (kind, item_id, day))`);
  await q(`CREATE TABLE IF NOT EXISTS view_seen (
    kind TEXT NOT NULL, item_id TEXT NOT NULL, viewer TEXT NOT NULL, last_at TEXT NOT NULL, PRIMARY KEY (kind, item_id, viewer))`);
  await q("CREATE INDEX IF NOT EXISTS idx_view_daily_day ON view_daily (day)");
  await q("CREATE INDEX IF NOT EXISTS idx_view_counts_total ON view_counts (kind, total DESC)");
}

// viewerId: account id when logged in, otherwise any coarse bucket (ip + user agent). Only its hash is stored.
// ownerKey: skip counting the author's own views.
export async function recordItemView(kind, itemId, { viewerId = null, bucket = "anon", isOwner = false } = {}) {
  if (!VIEW_KINDS.includes(kind) || !itemId || isOwner) return false;
  const viewer = hash(viewerId || bucket || "anon");
  const k = `${kind}:${itemId}:${viewer}`;
  const nowMs = Date.now();
  if ((recent.get(k) || 0) > nowMs - WINDOW_MS) return false;
  recent.set(k, nowMs); if (recent.size > 100000) recent.clear();

  const ts = new Date(nowMs).toISOString();
  const seen = await contentDb.prepare("SELECT last_at FROM view_seen WHERE kind = ? AND item_id = ? AND viewer = ?").get(kind, itemId, viewer);
  if (seen && nowMs - new Date(seen.last_at).getTime() < WINDOW_MS) return false;
  await contentDb.prepare("INSERT INTO view_seen (kind, item_id, viewer, last_at) VALUES (?,?,?,?) ON CONFLICT (kind, item_id, viewer) DO UPDATE SET last_at = excluded.last_at").run(kind, itemId, viewer, ts);
  await contentDb.prepare(`INSERT INTO view_counts (kind, item_id, total, uniques, first_at, last_at) VALUES (?,?,1,?,?,?)
    ON CONFLICT (kind, item_id) DO UPDATE SET total = view_counts.total + 1, uniques = view_counts.uniques + ?, last_at = excluded.last_at`)
    .run(kind, itemId, seen ? 0 : 1, ts, ts, seen ? 0 : 1);
  await contentDb.prepare("INSERT INTO view_daily (kind, item_id, day, n) VALUES (?,?,?,1) ON CONFLICT (kind, item_id, day) DO UPDATE SET n = view_daily.n + 1").run(kind, itemId, day(new Date(nowMs)));
  return true;
}

export async function getViewCounts(kind, ids) {
  if (!ids?.length) return {};
  const ph = ids.map(() => "?").join(",");
  const rows = await contentDb.prepare(`SELECT item_id, total, uniques FROM view_counts WHERE kind = ? AND item_id IN (${ph})`).all(kind, ...ids);
  return Object.fromEntries(rows.map((r) => [r.item_id, { total: Number(r.total), uniques: Number(r.uniques) }]));
}

export async function viewTotals() {
  const rows = await contentDb.prepare("SELECT kind, COUNT(*) items, COALESCE(SUM(total),0) total, COALESCE(SUM(uniques),0) uniques FROM view_counts GROUP BY kind ORDER BY total DESC").all();
  return rows.map((r) => ({ kind: r.kind, items: Number(r.items), total: Number(r.total), uniques: Number(r.uniques) }));
}
export async function topViewed(kind, limit = 25) {
  return (await contentDb.prepare("SELECT item_id, total, uniques, last_at FROM view_counts WHERE kind = ? ORDER BY total DESC LIMIT ?").all(kind, limit))
    .map((r) => ({ id: r.item_id, total: Number(r.total), uniques: Number(r.uniques), lastAt: r.last_at }));
}
export async function deleteViewsFor(kind, itemId) {
  for (const t of ["view_counts", "view_daily", "view_seen"]) await contentDb.prepare(`DELETE FROM ${t} WHERE kind = ? AND item_id = ?`).run(kind, itemId);
}
