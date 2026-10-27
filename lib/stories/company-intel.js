// Company analytics: reads published stories and other aggregate tables, hands counts to the pure
// functions in company-metrics.js. Privacy rules enforced HERE (not in the UI):
//   * stories are loaded with their author column only so people can be COUNTED; it is never returned
//   * any breakdown (role, department, location, industry peer) needs MIN_COHORT people, or it is withheld
//   * peers in a benchmark are never named, and need at least 5 companies with enough stories
import { contentDb } from "../content/db.js";
import { companyReality, normCompany, StoryError } from "./service.js";
import { THEMES, THEME_BY_KEY } from "./themes.js";
import { has, advanced, levelOf } from "../business-features.js";
import * as M from "./company-metrics.js";

const DAY = M.DAY, nowIso = () => new Date().toISOString();
export const FAQ_TOPICS = [
  ["salary", "Salary philosophy", "How do you decide pay, and how often is it reviewed?"], ["hours", "Working hours", "What are normal hours, and how is overtime handled and paid?"],
  ["remote", "Remote work", "What is the remote / in-office policy right now?"], ["leave", "Leave", "Annual, sick, parental and other leave."],
  ["benefits", "Benefits", "Insurance, pension, allowances and other benefits."], ["promotion", "Promotion", "How do promotions work, and how often do they happen?"],
  ["training", "Training", "Learning budgets, mentoring and development."], ["management", "Management", "How are managers selected, trained and held to account?"],
  ["interview", "Interview process", "Stages, timelines and how candidates hear back."], ["probation", "Probation", "How long it lasts and what happens at the end."],
  ["inclusion", "Diversity & inclusion", "Policies, programmes and how concerns are raised."], ["culture", "Work culture", "What day-to-day working here is like."],
];

const STORY_COLS = "id, format, title, body, told, actual, impact, themes, created_at, anonymous_id, employment_claim, department, location, leave_reasons, details, role_title";
export async function loadPrepared(c, days = 365) {
  const since = new Date(Date.now() - days * DAY).toISOString();
  const rows = await contentDb.prepare(`SELECT ${STORY_COLS} FROM stories WHERE status='published' AND (company_id = ? OR company_key = ?) AND created_at > ? ORDER BY created_at DESC LIMIT 5000`).all(c.id, normCompany(c.name), since);
  return M.prep(rows);
}
export async function loadReplies(companyId) {
  return contentDb.prepare("SELECT story_id, created_at FROM company_responses WHERE company_id = ? AND kind = 'reply' AND story_id IS NOT NULL").all(companyId);
}
export async function faqCount(companyId) { return Number((await contentDb.prepare("SELECT COUNT(*) n FROM company_faq WHERE company_id = ?").get(companyId)).n); }
// 0-100: how openly the company has told candidates things (FAQ answered, a recent announcement, facts filled in).
export async function transparencyScore(companyId) {
  const [f, a, facts] = await Promise.all([
    faqCount(companyId),
    contentDb.prepare("SELECT COUNT(*) n FROM company_announcements WHERE company_id = ? AND created_at > ?").get(companyId, new Date(Date.now() - 180 * DAY).toISOString()),
    contentDb.prepare("SELECT COUNT(*) n FROM company_profile WHERE company_id = ? AND section LIKE 'fact:%'").get(companyId),
  ]);
  return Math.min(100, Math.round((f / FAQ_TOPICS.length) * 60 + (Number(a.n) > 0 ? 25 : 0) + Math.min(3, Number(facts.n)) * 5));
}

// ------------------------------------------------------------------ initiatives
export function initiativeProgress(i, rows, now = Date.now()) {
  const current = M.distinct(M.within(rows, now - 90 * DAY, now).filter((r) => r._t.includes(i.theme)));
  const base = Number(i.baseline), change = base ? Math.round(((current - base) / base) * 100) : null;
  const ageDays = Math.floor((now - new Date(i.created_at).getTime()) / DAY);
  const label = THEME_BY_KEY[i.theme]?.label || i.theme;
  const improved = base >= 5 && change != null && change <= -20 && ageDays >= 30;
  return { id: i.id, title: i.title, theme: i.theme, themeLabel: label, target: i.target, status: i.status, baseline: base, current, change, ageDays, improved,
    text: improved ? `Reports concerning ${label} have declined ${Math.abs(change)}% since you started (${base} → ${current} people in the latest 90 days).`
      : base < 5 ? `Not enough reports at the start (${base}) to measure change reliably. Progress shows once there are at least 5.`
      : ageDays < 30 ? "Early days. Change is measured after 30 days." : `Reports concerning ${label}: ${base} → ${current} (${change > 0 ? "+" : ""}${change}%).` };
}

// ------------------------------------------------------------------ benchmark (Business Pro+)
async function peerData(c, days = 180) {
  const since = new Date(Date.now() - days * DAY).toISOString();
  const rows = await contentDb.prepare(
    `SELECT s.company_id cid, s.id, s.format, s.title, s.body, s.told, s.actual, s.impact, s.themes, s.created_at, s.anonymous_id, s.details FROM stories s JOIN companies x ON x.id = s.company_id
     WHERE s.status='published' AND x.status='active' AND x.industry = ? AND x.id <> ? AND s.created_at > ? ORDER BY s.created_at DESC LIMIT 40000`).all(c.industry, c.id, since);
  const by = new Map(); for (const r of rows) { (by.get(r.cid) || by.set(r.cid, []).get(r.cid)).push(r); }
  const ids = [...by.keys()];
  const replied = ids.length ? await contentDb.prepare("SELECT company_id cid, COUNT(DISTINCT story_id) n FROM company_responses WHERE kind='reply' AND story_id IS NOT NULL AND company_id = ANY(?) GROUP BY company_id").all(ids) : [];
  const rep = Object.fromEntries(replied.map((r) => [r.cid, Number(r.n)]));
  return [...by.entries()].map(([cid, rs]) => ({ cid, rows: M.prep(rs), replied: rep[cid] || 0 }));
}
const metricsOf = (rows, replied) => {
  const b = M.baseHealth(rows), hire = M.hiringExperience(rows), comp = Object.fromEntries(b.components.map((x) => [x.key, x.score]));
  const total = M.distinct(rows);
  return { reputation: b.score, response_rate: total >= 5 ? Math.min(100, Math.round((replied / total) * 100)) : null, hiring: hire.ready ? hire.score : null,
    management: comp.management, workload: comp.workload, compensation: comp.compensation, career: comp.career, communication: comp.communication };
};
const BENCH_LABELS = { reputation: "Reputation health", response_rate: "Response rate (%)", hiring: "Hiring experience", management: "Management", workload: "Workload", compensation: "Compensation", career: "Career development", communication: "Communication" };

export async function benchmarkFor(c) {
  if (!c.industry) return { ready: false, note: "Add your industry on the company page to see benchmarks." };
  const peers = (await peerData(c)).map((p) => metricsOf(p.rows, p.replied));
  const eligible = peers.filter((p) => p.reputation != null);
  if (eligible.length < MIN_PEERS) return { ready: false, industry: c.industry, peers: eligible.length, note: `Benchmarks need at least ${MIN_PEERS} other ${c.industry} companies with enough stories. Right now there are ${eligible.length}. Peers are never named.` };
  const mine = await loadPrepared(c, 180);
  const replies = await loadReplies(c.id);
  const mineReplied = new Set(replies.filter((r) => mine.some((s) => s.id === r.story_id)).map((r) => r.story_id)).size;
  const my = metricsOf(mine, mineReplied);
  const metrics = Object.keys(BENCH_LABELS).map((k) => {
    const vals = peers.map((p) => p[k]).filter((v) => v != null);
    if (vals.length < MIN_PEERS || my[k] == null) return { key: k, label: BENCH_LABELS[k], you: my[k] ?? null, available: false };
    return { key: k, label: BENCH_LABELS[k], available: true, you: my[k], median: M.medianOf(vals), top10: M.p90Of(vals), percentile: M.percentileOf(my[k], vals) };
  });
  return { ready: true, industry: c.industry, peers: eligible.length, metrics, note: "Compared with other companies in your industry over 180 days. Each metric is shown only when at least 5 peers have enough data. Peers are never named. Higher is better; this reflects what people shared, not an audit." };
}
const MIN_PEERS = 5;

// ------------------------------------------------------------------ salary intelligence
async function salaryItems(companyId) {
  const a = await contentDb.prepare("SELECT role_title role, amount FROM company_salaries WHERE company_id = ? LIMIT 5000").all(companyId);
  return a;
}
export async function salaryIntel(c, plan) {
  const mine = M.salaryStats(await salaryItems(c.id));
  const lvl = levelOf(plan, "salary_intel");
  const out = { level: lvl, submissions: mine.submissions, overall: mine.overall, roles: lvl === "basic" ? [] : mine.roles, hiddenRoles: mine.hidden, vsIndustry: [],
    note: "Amounts are shown as submitted; currency is not converted. We show the middle 50% and the median, never the lowest or highest, and only for groups of at least 5 people." };
  if (!mine.overall) out.note = `Pay ranges appear once at least ${M.MIN_COHORT} people have shared pay. ` + out.note;
  if (advanced(plan, "salary_intel") && c.industry && mine.roles.length) {
    const rows = await contentDb.prepare("SELECT s.company_id cid, s.role_title role, s.amount FROM company_salaries s JOIN companies x ON x.id = s.company_id WHERE x.industry = ? AND x.id <> ? AND x.status = 'active' LIMIT 20000").all(c.industry, c.id);
    const byRole = new Map();
    for (const r of rows) { const v = M.parseAmount(r.amount); if (v == null) continue; const k = String(r.role || "").toLowerCase().replace(/\b(senior|sr|junior|jr|lead|principal|staff)\b\.?/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(); if (!k) continue; (byRole.get(k) || byRole.set(k, { v: [], cos: new Set() }).get(k)).v.push(v); byRole.get(k).cos.add(r.cid); }
    for (const r of mine.roles) { const g = byRole.get(r.role); if (g && g.v.length >= M.MIN_COHORT && g.cos.size >= 3) { const med = M.quantile(g.v.sort((a, b) => a - b), 0.5); out.vsIndustry.push({ role: r.role, you: r.median, industryMedian: med, diffPct: med ? Math.round(((r.median - med) / med) * 100) : null }); } }
  }
  return out;
}

// ------------------------------------------------------------------ signals shared by overview, badges and the public page
const sigCache = new Map();
export async function signals(c, { fresh = false } = {}) {
  const hit = sigCache.get(c.id); if (!fresh && hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.v;
  const rows = await loadPrepared(c, 365), replies = await loadReplies(c.id), transp = await transparencyScore(c.id);
  const resp = M.responseMetrics({ stories: rows, replies, transparency: transp });
  const reality = await companyReality(c.id, { tier: "pro" });
  const claims = (reality?.claims || []).map((x) => ({ status: x.truthGap.status, topic: x.topic, claim: x.claim, label: x.truthGap.label, id: x.id }));
  const health = M.fullHealth({ rows: M.within(rows, Date.now() - 180 * DAY), claims, response: resp });
  const trend = M.summarizeTrend(M.monthlyTrend(rows, 12));
  const inits = (await contentDb.prepare("SELECT * FROM company_initiatives WHERE company_id = ?").all(c.id)).map((i) => initiativeProgress(i, rows));
  const faq = await faqCount(c.id);
  const sal = M.salaryStats(await salaryItems(c.id));
  const badges = M.badgeStatus({ response: resp, health, trend, improved: inits.filter((i) => i.improved).length, faqAnswered: faq, salaryN: sal.submissions, hiring: health.hiring, storyCount: M.distinct(rows) });
  const v = { rows, replies, resp, claims, health, trend, inits, faq, badges, reality, storyCount: M.distinct(rows) };
  sigCache.set(c.id, { at: Date.now(), v }); if (sigCache.size > 500) sigCache.clear();
  return v;
}

// What the public sees: labels only, and only when there is enough data behind them.
export async function publicSignals(c) {
  const s = await signals(c);
  return {
    health: s.health.score != null && s.storyCount >= 10 ? { label: s.health.label, note: "A summary of Stories people shared. It is not a rating and moves as more people share." } : null,
    response: s.resp.eligible ? { label: s.resp.label, rate: s.resp.rate, medianHours: s.resp.medianHours } : null,
    badges: s.badges.filter((b) => b.earned).map((b) => ({ key: b.key, label: b.label, criteria: b.criteria })),
  };
}

// ------------------------------------------------------------------ the Command Center
export async function overview(ctx) {
  const c = ctx.c, plan = ctx.plan, s = await signals(c, { fresh: true }), now = Date.now();
  const rows = s.rows, repliedIds = new Set(s.replies.map((r) => r.story_id));
  const last30 = M.within(rows, now - 30 * DAY, now), prev30 = M.within(rows, now - 60 * DAY, now - 30 * DAY);
  const win180 = M.within(rows, now - 180 * DAY, now);
  const unanswered = win180.filter((r) => !repliedIds.has(r.id));
  const dist = (a) => M.distinct(a);
  const trendPoints = M.monthlyTrend(rows, 12);
  // History is append-only: a month's score is stored once the month is over, and the stored value is what we show.
  const snaps = await contentDb.prepare("SELECT month, health, stories, reply_rate FROM company_snapshots WHERE company_id = ? ORDER BY month").all(c.id);
  const snapBy = Object.fromEntries(snaps.map((x) => [x.month, x])); const thisMonth = new Date().toISOString().slice(0, 7);
  for (const p of trendPoints) {
    if (p.month >= thisMonth) continue;
    if (snapBy[p.month]?.health != null) p.score = snapBy[p.month].health;
    else if (p.score != null) await contentDb.prepare("INSERT INTO company_snapshots (company_id, month, health, stories, created_at) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING").run(c.id, p.month, p.score, p.stories, nowIso()).catch(() => {});
  }
  const history = [...new Set([...snaps.filter((x) => x.health != null).map((x) => x.month), ...trendPoints.filter((p) => p.score != null).map((p) => p.month)])].sort()
    .map((m) => ({ month: m, score: trendPoints.find((p) => p.month === m)?.score ?? snapBy[m]?.health ?? null }));
  const issues = M.topIssues(rows, now);
  const events = await contentDb.prepare("SELECT COUNT(*) n FROM company_alert_events WHERE company_id = ? AND read_at IS NULL").get(c.id);
  const sentiment = M.monthKeys(6).map((m) => { const rs = rows.filter((r) => String(r.created_at).slice(0, 7) === m && ["current", "former"].includes(r.employment_claim)); const n = dist(rs); return { month: m, positivePct: n >= M.MIN_COHORT ? Math.round((dist(rs.filter(M.isPositive)) / n) * 100) : null }; });
  const out = {
    company: { id: c.id, name: c.name, industry: c.industry },
    health: { score: s.health.score, label: s.health.label, components: s.health.components.map((x) => ({ key: x.key, label: x.label, score: x.score })), note: "Built from Stories people shared. It is a summary, not a rating, and it moves as more people share." },
    counts: { storiesMonth: dist(last30), storiesPrev: dist(prev30), unanswered: unanswered.length, total: s.storyCount },
    response: { score: s.resp.score, label: s.resp.label, rate: s.resp.rate, medianHours: s.resp.medianHours, eligible: s.resp.eligible, consistency: s.resp.consistency, candidateRate: s.resp.candidateRate, transparency: s.resp.transparency, note: s.resp.note },
    positiveNegative: { positive: dist(last30.filter(M.isPositive)), negative: dist(last30.filter(M.isNegative)), prevPositive: dist(prev30.filter(M.isPositive)), prevNegative: dist(prev30.filter(M.isNegative)) },
    topIssues: issues.top, emerging: issues.emerging,
    claims: s.claims.map((x) => ({ topic: x.topic, claim: x.claim, status: x.status, label: x.label })),
    badges: s.badges.map((b) => ({ key: b.key, label: b.label, criteria: b.criteria, earned: b.earned })),
    alertsUnread: Number(events.n),
    gates: { trends: has(plan, "reputation_trends"), changes: has(plan, "what_changed"), benchmark: has(plan, "benchmarks"), improvement: has(plan, "improvement") },
  };
  if (out.gates.trends) { out.trend = { points: trendPoints, history, ...M.summarizeTrend(trendPoints) }; out.sentiment = sentiment; }
  if (out.gates.changes) out.changed = M.whatChanged(rows, now);
  if (out.gates.benchmark) { const b = await benchmarkFor(c).catch(() => null); out.percentile = b?.ready ? b.metrics.find((m) => m.key === "reputation")?.percentile ?? null : null; }
  return out;
}

// ------------------------------------------------------------------ Insights tab
export async function insights(ctx) {
  const c = ctx.c, plan = ctx.plan; const s = await signals(c);
  const rows = s.rows, now = Date.now(), win = M.within(rows, now - 180 * DAY, now);
  const weeks = {}; for (const r of win) { const d = new Date(r.created_at); const w = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10); weeks[w] = (weeks[w] || 0) + 1; }
  const themes = THEMES.map((t) => ({ key: t.key, label: t.label, reports: M.distinct(win.filter((r) => r._t.includes(t.key))) })).filter((t) => t.reports >= 2).sort((a, b) => b.reports - a.reports);
  const out = { level: levelOf(plan, "insights"), stories180: M.distinct(win), weekly: Object.entries(weeks).sort().slice(-26).map(([week, n]) => ({ week, n })), themes,
    patterns: (s.reality?.patterns || []).map((p) => ({ theme: p.theme, count: p.count, text: p.text })), askBeforeJoining: s.reality?.askBeforeJoining || [],
    leaving: s.reality?.leaving || null, note: "Aggregates only. You can reply to any story, but you cannot see who wrote it, hide it or edit it." };
  if (has(plan, "hiring_analytics")) out.hiring = s.health.hiring;
  if (has(plan, "salary_intel")) out.salary = await salaryIntel(c, plan);
  if (has(plan, "claim_consistency")) out.claims = s.claims;
  if (has(plan, "benchmarks")) out.benchmark = await benchmarkFor(c);
  return out;
}

// ------------------------------------------------------------------ employer brand analytics (Business Pro+)
export async function brandAnalytics(ctx) {
  const c = ctx.c, day = (n) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
  const views = async (a, b) => Number((await contentDb.prepare("SELECT COALESCE(SUM(n),0) n FROM company_page_views WHERE company_id = ? AND day > ? AND day <= ?").get(c.id, day(a), day(b))).n);
  const ids = (await contentDb.prepare("SELECT id FROM stories WHERE status='published' AND (company_id = ? OR company_key = ?) LIMIT 2000").all(c.id, normCompany(c.name))).map((r) => r.id);
  const storyViews = ids.length ? Number((await contentDb.prepare("SELECT COALESCE(SUM(n),0) n FROM story_views WHERE story_id = ANY(?) AND day > ?").get(ids, day(30))).n) : 0;
  const interest = Number((await contentDb.prepare("SELECT COUNT(*) n FROM company_interest WHERE company_id = ?").get(c.id)).n);
  const q = await contentDb.prepare("SELECT status, COUNT(*) n FROM company_questions WHERE company_id = ? GROUP BY status").all(c.id);
  return { profileViews30: await views(30, 0), profileViewsPrev30: await views(60, 30), storyViews30: storyViews,
    talentInterest: interest >= M.MIN_COHORT ? interest : null, talentInterestNote: interest >= M.MIN_COHORT ? null : `Shown once at least ${M.MIN_COHORT} people have said they're interested.`,
    questionsOpen: Number(q.find((x) => x.status === "open")?.n || 0), questionsAnswered: Number(q.find((x) => x.status === "answered")?.n || 0),
    soon: ["Job views and applications", "Follower growth", "Candidate conversion", "Employee advocacy"] };
}

// ------------------------------------------------------------------ reports
export async function reportData(ctx, { from, to } = {}) {
  const c = ctx.c, now = Date.now();
  const end = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? new Date(to + "T23:59:59Z").getTime() : now;
  const start = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? new Date(from + "T00:00:00Z").getTime() : end - 30 * DAY;
  if (start >= end || end - start > 400 * DAY) throw new StoryError("Choose a date range of up to 13 months.", 400, "BAD_RANGE");
  const s = await signals(c), rows = M.within(s.rows, start, end), replied = new Set(s.replies.map((r) => r.story_id));
  const first = new Map(); for (const r of s.replies) { const cur = first.get(r.story_id); if (!cur || r.created_at < cur) first.set(r.story_id, r.created_at); }
  const hrs = rows.filter((r) => first.has(r.id)).map((r) => (new Date(first.get(r.id)) - new Date(r.created_at)) / 36e5).filter((h) => h >= 0).sort((a, b) => a - b);
  const themeRows = THEMES.map((t) => ({ theme: t.label, reporters: M.distinct(rows.filter((r) => r._t.includes(t.key))) })).filter((t) => t.reporters >= 2).sort((a, b) => b.reporters - a.reporters);
  return { company: c.name, from: new Date(start).toISOString().slice(0, 10), to: new Date(end).toISOString().slice(0, 10), generatedAt: nowIso(),
    stories: M.distinct(rows), answered: rows.filter((r) => replied.has(r.id)).length, unanswered: rows.filter((r) => !replied.has(r.id)).length,
    medianResponseHours: hrs.length ? Math.round(hrs[Math.floor(hrs.length / 2)] * 10) / 10 : null,
    health: { score: s.health.score, label: s.health.label }, response: { label: s.resp.label, rate: s.resp.rate }, trend: s.trend.text,
    themes: themeRows, changed: M.whatChanged(s.rows, end), initiatives: s.inits.map((i) => ({ title: i.title, status: i.status, text: i.text })),
    note: "Aggregates of what people shared. No author, salary submitter or voter is identifiable from this report." };
}
const csvCell = (v) => { const t = String(v ?? ""); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
export async function exportCsv(ctx, kind, range = {}) {
  const c = ctx.c, slug = c.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const lines = [];
  if (kind === "stories") {
    const s = await signals(c), replied = new Set(s.replies.map((r) => r.story_id));
    lines.push("date,format,themes,answered");
    for (const r of s.rows) lines.push([r.created_at.slice(0, 10), r.format, r._t.join("; "), replied.has(r.id) ? "yes" : "no"].map(csvCell).join(","));   // never an author, department or location
  } else if (kind === "history") {
    const o = await overview(ctx); lines.push("month,health");
    for (const h of o.trend?.history || []) lines.push(`${h.month},${h.score ?? ""}`);
  } else {
    const r = await reportData(ctx, range); lines.push("section,label,value");
    lines.push(`summary,stories,${r.stories}`, `summary,answered,${r.answered}`, `summary,unanswered,${r.unanswered}`, `summary,median response hours,${r.medianResponseHours ?? ""}`, `summary,reputation health,${csvCell(r.health.label)}`, `summary,response label,${csvCell(r.response.label)}`);
    for (const t of r.themes) lines.push(`theme reports,${csvCell(t.theme)},${t.reporters}`);
  }
  return { filename: `${slug}-linkedout-${kind || "summary"}.csv`, csv: lines.join("\n") };
}
