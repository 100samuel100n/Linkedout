// Creator analytics + exports (OUT PRO). Views are counted per story per day and never record who
// looked. Owners' own views and repeat refreshes are not counted.
import { contentDb } from "../content/db.js";

const day = (d = new Date()) => d.toISOString().slice(0, 10);
const viewed = new Map();   // in-process dedupe: (story, viewer-ish key) -> day, to blunt refresh-spam
export async function recordView(storyId, viewerKey, ownerKey, bucket) {
  if (!storyId || (viewerKey && viewerKey === ownerKey)) return;
  const k = `${storyId}:${viewerKey || bucket || "anon"}`; const d = day();
  if (viewed.get(k) === d) return; viewed.set(k, d); if (viewed.size > 50000) viewed.clear();
  await contentDb.prepare("INSERT INTO story_views (story_id, day, n) VALUES (?,?,1) ON CONFLICT (story_id, day) DO UPDATE SET n = story_views.n + 1").run(storyId, d);
  await contentDb.prepare("UPDATE stories SET views = views + 1 WHERE id = ?").run(storyId);
}

export async function creatorAnalytics(ownerKeys, days = 30) {
  if (!ownerKeys.length) return { totals: {}, stories: [], series: [] };
  const ph = ownerKeys.map(() => "?").join(",");
  const stories = await contentDb.prepare(`SELECT id, title, body, format, company_name, status, created_at, views FROM stories WHERE anonymous_id IN (${ph}) AND status <> 'removed' ORDER BY created_at DESC LIMIT 200`).all(...ownerKeys);
  if (!stories.length) return { totals: { stories: 0, views: 0, meToo: 0, tracking: 0, updates: 0 }, stories: [], series: [] };
  const ids = stories.map((s) => s.id); const sp = ids.map(() => "?").join(",");
  const since = day(new Date(Date.now() - days * 864e5));
  const [mt, fl, up, vw] = await Promise.all([
    contentDb.prepare(`SELECT story_id, COUNT(*) n, SUM(CASE WHEN same_company = 1 THEN 1 ELSE 0 END) sc FROM story_me_too WHERE story_id IN (${sp}) GROUP BY story_id`).all(...ids),
    contentDb.prepare(`SELECT story_id, COUNT(*) n FROM story_follows WHERE story_id IN (${sp}) GROUP BY story_id`).all(...ids),
    contentDb.prepare(`SELECT story_id, COUNT(*) n FROM story_updates WHERE story_id IN (${sp}) GROUP BY story_id`).all(...ids),
    contentDb.prepare(`SELECT day, SUM(n) n FROM story_views WHERE story_id IN (${sp}) AND day >= ? GROUP BY day ORDER BY day`).all(...ids, since),
  ]);
  const by = (rows, f = "n") => Object.fromEntries(rows.map((r) => [r.story_id, Number(r[f])]));
  const m = by(mt), sc = by(mt, "sc"), f = by(fl), u = by(up);
  const rows = stories.map((s) => ({ id: s.id, title: s.title || s.body.slice(0, 70), format: s.format, company: s.company_name, status: s.status, date: s.created_at.slice(0, 10), views: s.views, meToo: m[s.id] || 0, sameCompany: sc[s.id] || 0, tracking: f[s.id] || 0, updates: u[s.id] || 0 }));
  const series = []; for (let i = days - 1; i >= 0; i--) { const d = day(new Date(Date.now() - i * 864e5)); series.push({ day: d, views: Number(vw.find((x) => x.day === d)?.n || 0) }); }
  return { totals: { stories: rows.length, views: rows.reduce((a, r) => a + r.views, 0), meToo: rows.reduce((a, r) => a + r.meToo, 0), tracking: rows.reduce((a, r) => a + r.tracking, 0), updates: rows.reduce((a, r) => a + r.updates, 0) }, stories: rows, series };
}

const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = (cols, rows) => [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n");

export async function exportOwnStories(ownerKeys) {
  const a = await creatorAnalytics(ownerKeys, 30);
  return a.stories;
}
export async function exportOwnStoriesFull(ownerKeys) {
  if (!ownerKeys.length) return [];
  const ph = ownerKeys.map(() => "?").join(",");
  return (await contentDb.prepare(`SELECT id, format, title, company_name, period, categories, body, told, actual, impact, outcome, status, created_at FROM stories WHERE anonymous_id IN (${ph}) ORDER BY created_at DESC`).all(...ownerKeys))
    .map((r) => ({ ...r, categories: JSON.parse(r.categories || "[]").join("; ") }));
}
