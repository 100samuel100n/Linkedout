// Pure functions behind the company dashboard. No database, no network: rows in, numbers out.
// That keeps the maths testable and keeps one rule obvious: nothing here can return an author,
// because the rows it is given are only ever counted ("distinct reporters"), never listed.
//
// Wording rule (legal + ethical), inherited from lib/stories/themes.js: everything describes what
// people REPORTED. Nothing says a company IS anything. The "health" label summarises shared Stories;
// it is not a rating, and it moves as more people share.
import { THEMES, THEME_BY_KEY, rowThemes } from "./themes.js";

export const DAY = 864e5;
export const MIN_COHORT = 5;          // no breakdown by department / location / role under this many reporters
export const MIN_HEALTH_STORIES = 8;  // health is withheld below this many stories in the window

const clamp = (n, a = 0, b = 100) => Math.max(a, Math.min(b, n));
const pct = (n, d) => (d ? Math.round((n / d) * 100) : null);
export const NEG_THEMES = THEMES.filter((t) => t.key !== "positive").map((t) => t.key);
const NEG_FORMATS = new Set(["laid_off", "fired", "red_flag", "ghosted", "warning", "whistleblower"]);

// Attach themes once per row (rowThemes runs regexes). Never copies author fields forward.
export function prep(rows) {
  return rows.map((r) => ({ id: r.id, format: r.format, created_at: r.created_at, anonymous_id: r.anonymous_id, employment_claim: r.employment_claim, details: r.details,
    department: r.department, location: r.location, leave_reasons: r.leave_reasons, role_title: r.role_title, _t: rowThemes(r) }));
}
export const distinct = (rows) => new Set(rows.map((r) => r.anonymous_id || r.id)).size;
export const isPositive = (r) => r.format === "green_flag" || r._t.includes("positive");
export const isNegative = (r) => NEG_FORMATS.has(r.format) || r._t.some((t) => t !== "positive");
export const within = (rows, fromMs, toMs = Date.now()) => rows.filter((r) => { const t = new Date(r.created_at).getTime(); return t > fromMs && t <= toMs; });
const J = (v, f) => { try { return JSON.parse(v); } catch { return f; } };

// ------------------------------------------------------------------ reputation health
export const HEALTH_COMPONENTS = [
  { key: "workplace",     label: "Workplace experience", themes: NEG_THEMES, k: 100, bonus: 40 },
  { key: "management",    label: "Management",           themes: ["intimidation", "unclear", "discrimination", "harassment"], k: 180, bonus: 30 },
  { key: "compensation",  label: "Compensation",         themes: ["unpaid_wages", "salary_change"], k: 180, bonus: 30 },
  { key: "career",        label: "Career development",   themes: ["broken_promise", "layoffs", "hiring_freeze"], k: 180, bonus: 30 },
  { key: "workload",      label: "Workload",             themes: ["unpaid_ot", "burnout", "rto"], k: 180, bonus: 30 },
  { key: "communication", label: "Communication",        themes: ["unclear", "broken_promise"], k: 180, bonus: 30 },
];

export function healthLabel(score) {
  if (score == null) return "Not enough data";
  return score >= 80 ? "Strong" : score >= 65 ? "Stable" : score >= 50 ? "Mixed" : "Needs attention";
}

// Score for one component over a set of prepared rows, or null when the sample is too small.
export function componentScore(rows, comp) {
  const total = distinct(rows); if (total < MIN_HEALTH_STORIES) return null;
  const hit = distinct(rows.filter((r) => r._t.some((t) => comp.themes.includes(t))));
  const pos = distinct(rows.filter(isPositive)) / total;
  return Math.round(clamp(100 - (hit / total) * comp.k + pos * comp.bonus));
}

// Hiring experience from interview-type stories (null under MIN_COHORT of them).
export function hiringExperience(rows) {
  const hr = rows.filter((r) => ["interview", "ghosted"].includes(r.format) || r._t.some((t) => ["ghosting", "salary_change"].includes(t)));
  const n = distinct(hr); if (n < MIN_COHORT) return { ready: false, stories: n, score: null };
  const neg = distinct(hr.filter((r) => r.format === "ghosted" || r._t.some((t) => ["ghosting", "salary_change", "intimidation", "broken_promise"].includes(t))));
  const pos = distinct(hr.filter(isPositive));
  const rounds = hr.map((r) => Number(J(r.details, {}).rounds)).filter((x) => x > 0 && x < 20);
  const ghosted = distinct(hr.filter((r) => r.format === "ghosted" || r._t.includes("ghosting")));
  return {
    ready: true, stories: n, score: Math.round(clamp(100 - (neg / n) * 100 + (pos / n) * 30)),
    positive: pos, negative: neg, neutral: Math.max(0, n - pos - neg), ghostedPct: pct(ghosted, n),
    avgRounds: rounds.length >= 3 ? Math.round((rounds.reduce((a, b) => a + b, 0) / rounds.length) * 10) / 10 : null,
    concerns: THEMES.filter((t) => ["ghosting", "salary_change", "intimidation", "broken_promise", "unclear"].includes(t.key))
      .map((t) => ({ theme: t.key, label: t.label, reporters: distinct(hr.filter((r) => r._t.includes(t.key))) })).filter((x) => x.reporters >= 3).sort((a, b) => b.reporters - a.reporters),
  };
}

// Job-claim consistency 0-100 from the existing Truth Gap statuses (null when no claim has enough reports).
export function claimsScore(claims) {
  const m = { aligned: 100, mixed: 60, differs: 20 };
  const v = (claims || []).map((c) => m[c.status ?? c.truthGap?.status]).filter((x) => x != null);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
}

// Base health: theme components only (used for trend, so past months stay comparable).
export function baseHealth(rows) {
  const components = HEALTH_COMPONENTS.map((c) => ({ key: c.key, label: c.label, score: componentScore(rows, c) }));
  const have = components.filter((c) => c.score != null);
  if (have.length < 3) return { score: null, label: healthLabel(null), components };
  return { score: Math.round(have.reduce((a, c) => a + c.score, 0) / have.length), label: healthLabel(Math.round(have.reduce((a, c) => a + c.score, 0) / have.length)), components };
}

// Full health: base components plus hiring, job-claim consistency and response transparency.
export function fullHealth({ rows, claims, response }) {
  const b = baseHealth(rows);
  const hiring = hiringExperience(rows);
  const extra = [
    { key: "hiring", label: "Hiring experience", score: hiring.ready ? hiring.score : null },
    { key: "claims", label: "Job-claim consistency", score: claimsScore(claims) },
    { key: "transparency", label: "Response transparency", score: response?.eligible ? response.score : null },
  ];
  const components = [...b.components, ...extra];
  const have = components.filter((c) => c.score != null);
  if (b.score == null || have.length < 3) return { score: null, label: healthLabel(null), components, hiring };
  const score = Math.round(have.reduce((a, c) => a + c.score, 0) / have.length);
  return { score, label: healthLabel(score), components, hiring };
}

// ------------------------------------------------------------------ trend and "what changed"
const ym = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
export function monthKeys(n = 12, now = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(ym(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  return out;
}
// Rolling three-month window ending at each month, so a quiet month doesn't blank the line.
export function monthlyTrend(rows, months = 12, now = new Date()) {
  return monthKeys(months, now).map((m) => {
    const [y, mo] = m.split("-").map(Number);
    const start = Date.UTC(y, mo - 3, 1), end = Date.UTC(y, mo, 1);
    const win = rows.filter((r) => { const t = new Date(r.created_at).getTime(); return t >= start && t < end; });
    const inMonth = rows.filter((r) => String(r.created_at).slice(0, 7) === m);
    return { month: m, score: baseHealth(win).score, stories: distinct(inMonth) };
  });
}
export function summarizeTrend(points) {
  const have = points.filter((p) => p.score != null);
  if (have.length < 2) return { direction: "unknown", text: "A trend appears once there are at least two months with enough stories." };
  const first = have[0], last = have[have.length - 1], d = last.score - first.score;
  const months = Math.max(1, monthKeys(60).indexOf(last.month) - monthKeys(60).indexOf(first.month));
  const direction = d >= 3 ? "up" : d <= -3 ? "down" : "steady";
  const p = first.score ? Math.round((Math.abs(d) / first.score) * 100) : 0;
  return { direction, change: d, from: first.score, to: last.score, text: direction === "steady" ? `Reputation health has been steady over the last ${months} month${months === 1 ? "" : "s"}.` : `Reputation health ${direction === "up" ? "improved" : "declined"} ${p}% over the last ${months} month${months === 1 ? "" : "s"} (${first.score} → ${last.score}).` };
}

export function whatChanged(rows, now = Date.now()) {
  const cur = within(rows, now - 30 * DAY, now), prev = within(rows, now - 60 * DAY, now - 30 * DAY);
  const positive = [], attention = [];
  for (const t of THEMES) {
    const c = distinct(cur.filter((r) => r._t.includes(t.key))), p = distinct(prev.filter((r) => r._t.includes(t.key)));
    if (c + p < 3 || Math.abs(c - p) < 2) continue;
    const change = p ? Math.round(((c - p) / p) * 100) : null;
    const up = c > p, line = `Reports mentioning ${t.label} ${up ? "increased" : "decreased"} (${p} → ${c}${change != null ? `, ${change > 0 ? "+" : ""}${change}%` : ""}).`;
    const good = t.key === "positive" ? up : !up;
    (good ? positive : attention).push({ theme: t.key, text: line, prev: p, now: c, change });
  }
  const by = (a, b) => Math.abs(b.now - b.prev) - Math.abs(a.now - a.prev);
  return { positive: positive.sort(by).slice(0, 5), attention: attention.sort(by).slice(0, 5), window: "Last 30 days vs the 30 days before. Counts are people who shared, not everyone who works there." };
}

// Top issues and the single most concerning emerging one (largest rise, min 3 reporters now).
export function topIssues(rows, now = Date.now()) {
  const cur = within(rows, now - 90 * DAY, now), prev = within(rows, now - 180 * DAY, now - 90 * DAY);
  const list = THEMES.filter((t) => t.key !== "positive").map((t) => ({ theme: t.key, label: t.label, reporters: distinct(cur.filter((r) => r._t.includes(t.key))), before: distinct(prev.filter((r) => r._t.includes(t.key))) })).filter((x) => x.reporters >= 3).sort((a, b) => b.reporters - a.reporters);
  const emerging = [...list].filter((x) => x.reporters - x.before >= 2).sort((a, b) => (b.reporters - b.before) - (a.reporters - a.before))[0] || null;
  return { top: list.slice(0, 5), emerging };
}

// ------------------------------------------------------------------ company response score
// Scores how a company RESPONDS to criticism, not whether it is "good". A company with problems can be Highly Responsive.
// stories: rows in the window; replies: [{story_id, created_at}] (any number per story).
export function responseMetrics({ stories, replies, transparency = 0, now = Date.now() }) {
  const win = stories.filter((s) => new Date(s.created_at).getTime() > now - 180 * DAY);
  const total = win.length;
  const first = new Map(); for (const r of replies) { const cur = first.get(r.story_id); if (!cur || r.created_at < cur) first.set(r.story_id, r.created_at); }
  const answered = win.filter((s) => first.has(s.id));
  const hours = answered.map((s) => (new Date(first.get(s.id)).getTime() - new Date(s.created_at).getTime()) / 36e5).filter((h) => h >= 0).sort((a, b) => a - b);
  const medianHours = hours.length ? Math.round(hours[Math.floor(hours.length / 2)] * 10) / 10 : null;
  const months = monthKeys(6, new Date(now)), active = months.filter((m) => win.some((s) => String(s.created_at).slice(0, 7) === m));
  const consistency = active.length >= 3 ? pct(active.filter((m) => answered.some((s) => String(s.created_at).slice(0, 7) === m)).length, active.length) : null;
  const cand = win.filter((s) => ["interview", "ghosted"].includes(s.format)); const candAnswered = cand.filter((s) => first.has(s.id));
  const candidateRate = cand.length >= 3 ? pct(candAnswered.length, cand.length) : null;
  const rate = pct(answered.length, total);
  const eligible = total >= 5;
  const timeScore = medianHours == null ? 0 : medianHours <= 24 ? 100 : medianHours <= 72 ? 80 : medianHours <= 168 ? 60 : medianHours <= 336 ? 30 : 10;
  const parts = [[rate, 0.4], [timeScore, 0.25], [consistency, 0.15], [candidateRate, 0.1], [clamp(transparency), 0.1]].filter(([v]) => v != null);
  const wsum = parts.reduce((a, [, w]) => a + w, 0);
  const score = eligible && wsum ? Math.round(parts.reduce((a, [v, w]) => a + v * w, 0) / wsum) : null;
  const label = !eligible ? "Not enough stories yet" : score >= 80 ? "Highly responsive" : score >= 60 ? "Responsive" : score >= 40 ? "Occasionally responsive" : "Rarely responds";
  return { eligible, stories: total, replied: answered.length, rate, medianHours, consistency, candidateRate, transparency: clamp(transparency), score, label,
    note: "Measures how the company responds to what people share, not whether the company is good or bad." };
}

// ------------------------------------------------------------------ salary intelligence
// Amounts are free text. Parse conservatively; anything we can't read is ignored, never guessed.
export function parseAmount(text) {
  const found = [...String(text || "").replace(/,/g, "").matchAll(/(\d+(?:\.\d+)?)\s*(k|m)?/gi)].map((m) => ({ n: parseFloat(m[1]), u: (m[2] || "").toLowerCase() }));
  if (!found.length) return null;
  // "50-70k": the unit on the second number applies to both.
  if (found.length >= 2 && !found[0].u && found[1].u && found[0].n < 1000) found[0].u = found[1].u;
  const nums = found.map((x) => x.n * (x.u === "k" ? 1e3 : x.u === "m" ? 1e6 : 1)).filter((v) => v > 0);
  const v = nums.length >= 2 ? (nums[0] + nums[1]) / 2 : nums[0];
  return v >= 100 ? Math.round(v) : null;   // under 100 is almost certainly an hourly rate or a typo: skip
}
export function quantile(sorted, q) { if (!sorted.length) return null; const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)); }
const normRole = (s) => String(s || "").toLowerCase().replace(/\b(senior|sr|junior|jr|lead|principal|staff)\b\.?/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
// items: [{role, amount}] → company-wide range and per-role ranges, only for cohorts >= MIN_COHORT.
// Returns the middle 50% (p25-p75) and the median, never min/max, which could point at one person.
export function salaryStats(items) {
  const vals = items.map((i) => ({ role: normRole(i.role), v: parseAmount(i.amount) })).filter((x) => x.v != null && x.role);
  const stat = (arr) => { const s = arr.map((x) => x.v).sort((a, b) => a - b); return { n: s.length, p25: quantile(s, 0.25), median: quantile(s, 0.5), p75: quantile(s, 0.75) }; };
  const byRole = {}; for (const x of vals) (byRole[x.role] ||= []).push(x);
  return {
    submissions: vals.length,
    overall: vals.length >= MIN_COHORT ? stat(vals) : null,
    roles: Object.entries(byRole).filter(([, a]) => a.length >= MIN_COHORT).map(([role, a]) => ({ role, ...stat(a) })).sort((a, b) => b.n - a.n).slice(0, 12),
    hidden: Object.values(byRole).filter((a) => a.length < MIN_COHORT).length,
  };
}

// ------------------------------------------------------------------ percentiles
export const percentileOf = (value, peers) => (peers.length ? Math.round((peers.filter((p) => p < value).length / peers.length) * 100) : null);
export const medianOf = (arr) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
export const p90Of = (arr) => { const s = [...arr].sort((a, b) => a - b); return s.length ? quantile(s, 0.9) : null; };

// ------------------------------------------------------------------ tone check for a draft reply
export function toneCheck(text) {
  const t = String(text || ""), low = t.toLowerCase(), issues = [];
  const add = (level, msg, fix) => issues.push({ level, msg, fix });
  if (/\b(we know who|whoever wrote|this (person|individual|user)|the author|you (are|were) (lying|a liar)|disgruntled|ex-?employee)\b/.test(low)) add("high", "This could read as trying to work out who wrote the story.", "Never guess or hint at who the author is. Respond to what was described.");
  if (/\b(defam\w*|legal action|sue\b|lawsuit|lawyers?|cease and desist)\b/.test(low)) add("high", "Legal threats tend to make a reply look like silencing.", "Say how people can raise concerns, and use the factual-dispute process if something is untrue.");
  if (/\b(false|fake|lies?|lying|baseless|untrue|fabricat\w*|made up|nonsense)\b/.test(low)) add("medium", "Flat denials rarely land well without specifics.", "Say what is inaccurate and what you can show, or acknowledge the experience first.");
  if (/\b(always|never|every(one| employee)|no one|nobody)\b/.test(low)) add("medium", "Absolute words are easy to disprove.", "Prefer “we aim to…” or “our policy is…”.");
  if (!/\b(sorry|thank|appreciate|hear|understand|take (this|it) seriously|acknowledge)\b/.test(low)) add("medium", "No acknowledgement of the person's experience.", "Open with thanks or an acknowledgement before anything defensive.");
  if (!/\b(will|we are|we're|we have|we've|contact|reach|policy|process|review|investigat\w*|team)\b/.test(low)) add("low", "No concrete next step.", "Add what you are doing, or where someone can raise it (a real address or process).");
  if ((t.match(/!/g) || []).length >= 2 || /[A-Z]{6,}/.test(t.replace(/\b[A-Z]{2,5}\b/g, ""))) add("low", "Shouting (capitals or exclamation marks) reads as defensive.", "Keep it calm and plain.");
  if (t.trim().length > 1200) add("low", "Long replies are rarely read in full.", "Aim for under 150 words.");
  if (t.trim().length < 40) add("low", "Very short; it may feel dismissive.", "Add one sentence on what happens next.");
  const high = issues.filter((i) => i.level === "high").length, med = issues.filter((i) => i.level === "medium").length;
  return { rating: high ? "Risky" : med >= 2 ? "Needs work" : med ? "Good, small tweaks" : "Good", issues };
}

// ------------------------------------------------------------------ non-AI helpers for reply drafting
const ACTIONS = {
  unpaid_wages: ["Confirm payroll dates with Finance and publish a clear payment schedule", "Name one person employees can contact about missed pay"],
  salary_change: ["Make sure offer letters match advertised ranges", "Confirm compensation in writing before candidates resign"],
  unpaid_ot: ["Audit after-hours expectations with team leads", "State overtime and time-off-in-lieu rules plainly"],
  burnout: ["Review workload and cover for the teams named most often", "Remind managers how leave and time off work"],
  intimidation: ["Offer a reporting route outside the reporting line", "Run manager-conduct training with real examples"],
  harassment: ["Publish the complaint process and who handles it outside the reporting line", "Check investigations are timely and communicated"],
  discrimination: ["Review the complaint process and its independence", "Share what has changed since earlier concerns"],
  unclear: ["Write down role expectations and priorities per team", "Set a regular cadence for goal updates"],
  broken_promise: ["Put hiring-stage promises (title, scope, promotion path) into offer letters", "Follow up on promised reviews with dates"],
  layoffs: ["Share the timeline and support offered (notice, severance, references)", "Brief managers before announcements, not after"],
  rto: ["Publish the office policy in one place and explain exceptions", "Give notice before any change"],
  hiring_freeze: ["Say plainly which roles are open and which are frozen"],
  ghosting: ["Commit to a response time at every hiring stage", "Close the loop with every interviewed candidate"],
};
export function suggestedActions(themes) { const out = []; for (const t of themes) for (const a of ACTIONS[t] || []) if (!out.includes(a)) out.push(a); return out.slice(0, 5); }

export function templateReply({ themes = [], companyName = "our company" }) {
  const label = themes.map((t) => THEME_BY_KEY[t]?.label).filter(Boolean)[0];
  return `Thank you for sharing this. We take what people tell us seriously${label ? `, including concerns about ${label}` : ""}, and we're sorry if anyone has had an experience like this at ${companyName}. We are looking into it and will share what we can as things change. If you or anyone else wants to raise something with us directly, [add your real contact or process here].`;
}

// ------------------------------------------------------------------ recognition (earned, objective, never purchased)
// Each badge carries its criteria so the dashboard can show progress and the public can see why it was earned.
export function badgeStatus({ response, health, trend, improved, faqAnswered, salaryN, hiring, storyCount }) {
  const sustained = response?.consistency != null && response.consistency >= 67;
  const list = [
    { key: "responsive", label: "Highly Responsive Employer", criteria: "At least 10 stories in 180 days, 80%+ answered, median reply within 72 hours, answered in most active months.",
      earned: !!response && response.stories >= 10 && (response.rate ?? 0) >= 80 && response.medianHours != null && response.medianHours <= 72 && sustained },
    { key: "transparent", label: "Transparent Employer", criteria: "At least 8 of the 12 candidate FAQ topics answered and a published claim-consistency record with no “reports differ”.",
      earned: faqAnswered >= 8 && !(health?.components || []).some((c) => c.key === "claims" && c.score != null && c.score < 40) },
    { key: "improving", label: "Improving Workplace", criteria: "Reputation health up 5+ points across at least 3 months of data, or an initiative with a 20%+ drop in related reports.",
      earned: (trend?.direction === "up" && (trend.change ?? 0) >= 5) || improved >= 1 },
    { key: "salary", label: "Salary Transparency", criteria: "At least 10 pay submissions, enough for published ranges.", earned: salaryN >= 10 },
    { key: "candidate", label: "Candidate-Friendly Employer", criteria: "At least 5 interview reports, under 15% ghosted, hiring experience 70+.",
      earned: !!hiring?.ready && (hiring.ghostedPct ?? 100) < 15 && (hiring.score ?? 0) >= 70 },
    { key: "rated", label: "Highly Rated Workplace", criteria: "Reputation health 80+ with at least 20 stories.", earned: (health?.score ?? 0) >= 80 && storyCount >= 20 },
  ];
  return list;
}
