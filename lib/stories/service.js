// Stories service. Route handlers call these; nothing here accepts an account
// id, email or real name — only alias ids and display labels, like the rest
// of the content store.
import crypto from "node:crypto";
import { contentDb, formatRelativeTime } from "../content/db.js";
import { redactFields, identityRisk } from "./redact.js";
import { classifyThemes } from "../ai.js";
import { storyRisk, STORY_CATEGORIES, STORY_FORMATS, WANT_OPTIONS, OUTCOMES, LEAVE_REASONS, WHO_OPTIONS, STORY_LIMITS, EVIDENCE_LEVELS, DEFAULT_CIRCLES, validKey } from "./constants.js";
import { THEMES, THEME_BY_KEY, themesIn, rowThemes, THEME_KEYS, patternLine, ASK_BEFORE_JOINING, CLAIM_TOPICS } from "./themes.js";

const DAY = 864e5;
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const J = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
const clip = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const pick = (arr, list, max) => [...new Set((Array.isArray(arr) ? arr : []).filter((x) => list.includes(x)))].slice(0, max);
const nowIso = () => new Date().toISOString();

export class StoryError extends Error {
  constructor(message, status = 400, code = "BAD_REQUEST") { super(message); this.status = status; this.code = code; }
}

// ---------------------------------------------------------------- shaping

function evidenceLevel(row, { evidenceCount = 0, independent = 0, publicDoc = false }) {
  if (publicDoc) return "public";
  if (independent >= 3) return "multiple";
  if (evidenceCount > 0) return "evidence";
  return "personal";
}

// Badges describe what the platform knows. They never say "true".
function badgesFor(row, level, extra) {
  const b = [];
  b.push({ key: level, label: EVIDENCE_LEVELS[level].label });
  if (level !== "evidence" && extra.evidenceCount > 0) b.push({ key: "evidence", label: "Evidence attached" });
  if (row.verified_employment) b.push({ key: "verified_employment", label: row.employment_claim === "current" ? "Verified current employee" : "Verified former employee" });
  else if (row.employment_claim === "former") b.push({ key: "claimed_former", label: "Former employee (self-declared)" });
  else if (row.employment_claim === "current") b.push({ key: "claimed_current", label: "Current employee (self-declared)" });
  if (extra.responses > 0) b.push({ key: "company_response", label: "Company response" });
  return b;
}

async function batchExtras(rows, viewerKey) {
  if (!rows.length) return {};
  const ids = rows.map((r) => r.id);
  const ph = ids.map(() => "?").join(",");
  const out = Object.fromEntries(ids.map((id) => [id, { same: 0, similar: 0, sameCompany: 0, updates: 0, evidenceCount: 0, responses: 0, mine: null, following: false }]));
  const q = (sql, ...p) => contentDb.prepare(sql).all(...p);
  for (const r of await q(`SELECT story_id, kind, same_company, COUNT(*) n FROM story_me_too WHERE story_id IN (${ph}) GROUP BY story_id, kind, same_company`, ...ids)) {
    const e = out[r.story_id]; const n = Number(r.n);
    if (r.kind === "same") e.same += n; else e.similar += n;
    if (Number(r.same_company)) e.sameCompany += n;
  }
  for (const r of await q(`SELECT story_id, COUNT(*) n FROM story_updates WHERE story_id IN (${ph}) GROUP BY story_id`, ...ids)) out[r.story_id].updates = Number(r.n);
  for (const r of await q(`SELECT story_id, COUNT(*) n FROM story_evidence WHERE story_id IN (${ph}) GROUP BY story_id`, ...ids)) out[r.story_id].evidenceCount = Number(r.n);
  for (const r of await q(`SELECT story_id, COUNT(*) n FROM company_responses WHERE story_id IN (${ph}) GROUP BY story_id`, ...ids)) out[r.story_id].responses = Number(r.n);
  if (viewerKey) {
    for (const r of await q(`SELECT story_id, kind FROM story_me_too WHERE anon_key = ? AND story_id IN (${ph})`, viewerKey, ...ids)) out[r.story_id].mine = r.kind;
    for (const r of await q(`SELECT story_id FROM story_follows WHERE anon_key = ? AND story_id IN (${ph})`, viewerKey, ...ids)) out[r.story_id].following = true;
  }
  return out;
}

// Independent corroboration: distinct authors with a story about the same company + same category set overlap.
async function independentCounts(rows) {
  const out = {};
  const keyed = rows.filter((r) => r.company_key);
  for (const r of keyed) {
    const cats = J(r.categories, []);
    if (!cats.length) { out[r.id] = 0; continue; }
    const row = await contentDb.prepare(
      `SELECT COUNT(DISTINCT anonymous_id) n FROM stories
         WHERE status = 'published' AND company_key = ? AND id <> ? AND anonymous_id IS DISTINCT FROM ?
           AND created_at > ? AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(categories::jsonb) c WHERE c = ANY (?::text[]))`
    ).get(r.company_key, r.id, r.anonymous_id, new Date(Date.now() - 365 * DAY).toISOString(), cats);
    out[r.id] = Number(row?.n || 0);
  }
  return out;
}

async function shape(rows, viewerKey, { full = false } = {}) {
  const extras = await batchExtras(rows, viewerKey);
  const indep = await independentCounts(rows);
  const publicByKey = {};
  for (const k of [...new Set(rows.map((r) => r.company_key).filter(Boolean))]) {
    publicByKey[k] = Number((await contentDb.prepare("SELECT COUNT(*) n FROM public_records WHERE company_key = ?").get(k)).n) > 0;
  }
  return rows.map((r) => {
    const ex = extras[r.id];
    const independent = indep[r.id] || 0;
    const level = evidenceLevel(r, { evidenceCount: ex.evidenceCount, independent, publicDoc: false });
    const fmt = STORY_FORMATS.find((f) => f.key === r.format);
    const s = {
      id: r.id, format: r.format, formatLabel: fmt?.label || "My Experience",
      title: r.title || null,
      who: r.who || null, company: r.company_name || null, companyId: r.company_id || null, industry: r.industry || null,
      department: r.department || null, roleTitle: r.role_title || null, tenure: r.tenure || null, location: r.location || null,
      period: r.period || null, happenedOn: r.happened_on || null,
      body: r.body, told: r.told || null, actual: r.actual || null, impact: r.impact || null,
      categories: J(r.categories, []), wants: J(r.wants, []), noAdvice: !!r.no_advice,
      details: J(r.details, {}), leaveReasons: J(r.leave_reasons, []),
      outcome: r.outcome, circleId: r.circle_id || null, noindex: !!r.noindex, views: r.views || 0, riskLevel: storyRisk(r.format, J(r.categories, [])).level,
      author: r.author_display, mode: r.mode,
      createdAt: r.created_at, time: formatRelativeTime(r.created_at),
      evidenceLevel: level, evidenceLabel: EVIDENCE_LEVELS[level].label,
      badges: badgesFor(r, level, ex),
      counts: { sameHere: ex.same, similar: ex.similar, total: ex.same + ex.similar, sameCompany: ex.sameCompany, otherCompanies: ex.same + ex.similar - ex.sameCompany, updates: ex.updates, evidence: ex.evidenceCount, responses: ex.responses, independentReports: independent },
      mine: ex.mine, following: ex.following, isOwner: !!viewerKey && r.anonymous_id === viewerKey,
      publiclyDocumented: !!(r.company_key && publicByKey[r.company_key] && r.format === "laid_off"),
    };
    s.pattern = null;
    return s;
  });
}

// ---------------------------------------------------------------- create

export async function createStory(input, identity, ctx = {}) {
  const f = STORY_FORMATS.find((x) => x.key === input.format);
  if (!f) throw new StoryError("Pick a story format.");
  const body = clip(input.body, STORY_LIMITS.body);
  const isDraft = input.status === "draft";
  if (!isDraft && body.length < 20) throw new StoryError("Tell us a little more about what happened (at least a couple of sentences).");

  const wants = pick(input.wants, WANT_OPTIONS.map((w) => w.key), 7);
  const categories = pick(input.categories, STORY_CATEGORIES, 3);
  const leave = pick(input.leaveReasons, LEAVE_REASONS, 4);
  const who = validKey(WHO_OPTIONS, input.who) ? input.who : null;
  const mode = ["real", "alias", "anon"].includes(input.mode) ? input.mode : "alias";

  // Details = per-format structured fields; keep it a flat object of short strings/numbers.
  const details = {};
  for (const [k, v] of Object.entries(input.details || {})) {
    if (!/^[a-zA-Z]{1,30}$/.test(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) details[k] = v;
    else if (typeof v === "string") details[k] = v.trim().slice(0, 600);
    else if (Array.isArray(v)) details[k] = v.filter((x) => typeof x === "string").map((x) => x.trim().slice(0, 120)).slice(0, 12);
  }

  const { values, counts } = redactFields({
    title: clip(input.title, STORY_LIMITS.title), body, told: clip(input.told, STORY_LIMITS.short), actual: clip(input.actual, STORY_LIMITS.short),
    impact: clip(input.impact, STORY_LIMITS.short), department: clip(input.department, STORY_LIMITS.field), roleTitle: clip(input.roleTitle, STORY_LIMITS.field),
    tenure: clip(input.tenure, 60), location: clip(input.location, STORY_LIMITS.field), period: clip(input.period, 60),
    ...Object.fromEntries(Object.entries(details).filter(([, v]) => typeof v === "string").map(([k, v]) => [`d_${k}`, v])),
  });
  for (const [k, v] of Object.entries(values)) if (k.startsWith("d_")) details[k.slice(2)] = v;

  let companyId = null; let companyName = clip(input.companyName, 120) || null; let industry = clip(input.industry, 80) || null;
  if (input.companyId) {
    const c = await contentDb.prepare("SELECT id, name, industry FROM companies WHERE id = ? AND status = 'active'").get(input.companyId);
    if (c) { companyId = c.id; companyName = c.name; industry = industry || c.industry || null; }
  } else if (companyName) {
    const c = await contentDb.prepare("SELECT id, name, industry FROM companies WHERE name_norm = ? AND status = 'active'").get(norm(companyName));
    if (c) { companyId = c.id; companyName = c.name; industry = industry || c.industry || null; }
  }
  const happenedOn = /^\d{4}-\d{2}-\d{2}$/.test(input.happenedOn || "") ? input.happenedOn : null;

  let status = "published"; let publishAt = null;
  if (isDraft) status = "draft";
  else if (input.publishAt) {
    const t = new Date(input.publishAt).getTime();
    if (!Number.isFinite(t) || t < Date.now()) throw new StoryError("Scheduled time must be in the future.");
    if (t > Date.now() + 90 * DAY) throw new StoryError("You can schedule up to 90 days ahead.");
    status = "scheduled"; publishAt = new Date(t).toISOString();
  }
  let circleId = null;
  if (input.circleSlug) circleId = (await contentDb.prepare("SELECT id FROM circles WHERE slug = ?").get(input.circleSlug))?.id || null;

  const replaceId = ctx.replaceId || null;
  let prior = null;
  if (replaceId) {
    prior = await contentDb.prepare("SELECT id, status, anonymous_id FROM stories WHERE id = ?").get(replaceId);
    if (!prior || prior.anonymous_id !== identity.anonymousId) throw new StoryError("We couldn't find that draft.", 404, "NOT_FOUND");
    if (prior.status === "published") throw new StoryError("Published stories can't be edited this way. Add an update instead.", 409, "ALREADY_PUBLISHED");
  } else {
    // Duplicate-submit guard: the same author sending the same text within a minute is a double click.
    const dup = await contentDb.prepare("SELECT id, status, noindex FROM stories WHERE anonymous_id = ? AND body = ? AND status = ? AND created_at > ? ORDER BY created_at DESC LIMIT 1")
      .get(identity.anonymousId, values.body, status, new Date(Date.now() - 60000).toISOString());
    if (dup) return { id: dup.id, status: dup.status, redactions: counts, noindex: !!dup.noindex, deduped: true };
  }
  const id = replaceId || crypto.randomUUID(); const now = nowIso();
  const keyOfCompany = companyName ? norm(companyName) : null;
  const verifiedKind = keyOfCompany && ctx.verified ? ctx.verified[keyOfCompany] : null;   // set only by the verification workflow
  const risk = identityRisk({ mode, company: companyName, department: values.department, location: values.location, roleTitle: values.roleTitle, tenure: values.tenure, period: values.period, text: values.body });
  const tier = storyRisk(f.key, categories);
  // High-risk stories (harassment, discrimination, whistleblowing) are NEVER search-indexed: that is a
  // safety rule, not a preference, so it is enforced here regardless of what the client sent.
  const noindex = (input.noindex || tier.forceNoindex || (mode === "anon" && risk.level === "high")) ? 1 : 0;
  const kwThemes = themesIn(`${values.title} ${values.body} ${values.told} ${values.actual} ${values.impact}`);
  if (replaceId) {
    await contentDb.prepare(
      `UPDATE stories SET format=?, title=?, who=?, company_id=?, company_name=?, company_key=?, industry=?, department=?, role_title=?, tenure=?, location=?, period=?, happened_on=?,
         body=?, told=?, actual=?, impact=?, categories=?, wants=?, no_advice=?, details=?, leave_reasons=?, employment_claim=?, circle_id=?, status=?, publish_at=?, mode=?,
         author_display=?, redactions=?, created_at=?, updated_at=?, verified_employment=?, noindex=?, themes=? WHERE id = ? AND anonymous_id = ?`
    ).run(
      f.key, values.title || null, who, companyId, companyName, companyName ? norm(companyName) : null, industry,
      values.department || null, values.roleTitle || null, values.tenure || null, values.location || null, values.period || null, happenedOn,
      values.body, values.told || null, values.actual || null, values.impact || null,
      JSON.stringify(categories), JSON.stringify(wants), input.noAdvice ? 1 : 0, JSON.stringify(details), JSON.stringify(leave),
      who || null, circleId, status, publishAt, mode, identity.displayLabel, JSON.stringify(counts),
      status === "published" ? now : prior.created_at || now, now, verifiedKind ? 1 : 0, noindex, JSON.stringify(kwThemes), id, identity.anonymousId
    );
    if (verifiedKind) await contentDb.prepare("UPDATE stories SET employment_claim = ? WHERE id = ?").run(verifiedKind, id);
    if (status === "published") afterPublish(id).catch(() => {});
    return { id, status, redactions: counts, noindex: !!noindex };
  }
  await contentDb.prepare(
    `INSERT INTO stories (id, format, title, who, company_id, company_name, company_key, industry, department, role_title, tenure, location, period, happened_on,
       body, told, actual, impact, categories, wants, no_advice, details, leave_reasons, outcome, employment_claim, circle_id, status, publish_at, mode,
       author_display, anonymous_id, source_post_id, redactions, created_at, updated_at, verified_employment, noindex, themes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, f.key, values.title || null, who, companyId, companyName, companyName ? norm(companyName) : null, industry,
    values.department || null, values.roleTitle || null, values.tenure || null, values.location || null, values.period || null, happenedOn,
    values.body, values.told || null, values.actual || null, values.impact || null,
    JSON.stringify(categories), JSON.stringify(wants), input.noAdvice ? 1 : 0, JSON.stringify(details), JSON.stringify(leave),
    "ongoing", who || null, circleId, status, publishAt, mode,
    identity.displayLabel, identity.anonymousId, input.sourcePostId || null, JSON.stringify(counts), now, now,
    verifiedKind ? 1 : 0, noindex, JSON.stringify(kwThemes)
  );
  if (verifiedKind) await contentDb.prepare("UPDATE stories SET employment_claim = ? WHERE id = ?").run(verifiedKind, id);
  if (status === "published") afterPublish(id).catch(() => {});
  return { id, status, redactions: counts, noindex: !!noindex };
}

// Scheduled stories go live when their time arrives. Called lazily on feed reads.
async function publishDue() {
  const due = await contentDb.prepare("SELECT id FROM stories WHERE status = 'scheduled' AND publish_at <= ?").all(nowIso());
  if (!due.length) return;
  await contentDb.prepare("UPDATE stories SET status = 'published', created_at = publish_at WHERE status = 'scheduled' AND publish_at <= ?").run(nowIso());
  for (const d of due) afterPublish(d.id).catch(() => {});
}

// Work that happens once a story is live: paraphrase-proof theme tagging, then alerts.
const hooks = { alerts: null };
export function setAlertHook(fn) { hooks.alerts = fn; }
async function afterPublish(id) {
  const r = await contentDb.prepare("SELECT id, title, body, told, actual, impact, themes FROM stories WHERE id = ?").get(id);
  if (!r) return;
  const ai = await classifyThemes(`${r.title || ""}\n${r.body}\n${r.told || ""}\n${r.actual || ""}`, THEME_KEYS);
  if (ai.length) {
    const merged = [...new Set([...J(r.themes, []), ...ai])];
    await contentDb.prepare("UPDATE stories SET themes = ? WHERE id = ?").run(JSON.stringify(merged), id);
  }
  if (!hooks.alerts) await import("./alerts.js").catch(() => {});
  if (hooks.alerts) await hooks.alerts(id);
}

// ---------------------------------------------------------------- read

export async function listStories({ viewerKey = null, category = null, format = null, company = null, companyId = null, circle = null, mine = null, q = null, before = null, limit = 20, sort = "recent" } = {}) {
  await publishDue();
  const where = ["s.status = 'published'"]; const p = [];
  if (category) { where.push("s.categories::jsonb ? ?"); p.push(category); }
  if (format) { where.push("s.format = ?"); p.push(format); }
  if (companyId) { where.push("s.company_id = ?"); p.push(companyId); }
  else if (company) { where.push("s.company_key = ?"); p.push(norm(company)); }
  if (circle) { where.push("s.circle_id = (SELECT id FROM circles WHERE slug = ?)"); p.push(circle); }
  if (q) { where.push("(s.body ILIKE ? OR s.title ILIKE ? OR s.company_name ILIKE ?)"); const l = `%${q.replace(/[%_]/g, "")}%`; p.push(l, l, l); }
  if (before) { where.push("s.created_at < ?"); p.push(before); }
  let sql = `SELECT s.* FROM stories s WHERE ${where.join(" AND ")} ORDER BY s.created_at DESC LIMIT ?`;
  if (sort === "resonating") {
    sql = `SELECT s.* FROM stories s LEFT JOIN (SELECT story_id, COUNT(*) n FROM story_me_too GROUP BY story_id) m ON m.story_id = s.id
           WHERE ${where.join(" AND ")} AND s.created_at > '${new Date(Date.now() - 30 * DAY).toISOString()}' ORDER BY COALESCE(m.n,0) DESC, s.created_at DESC LIMIT ?`;
  }
  // `jsonb ?` clashes with the adapter's `?` placeholders, so use the function form instead.
  sql = sql.replace(/s\.categories::jsonb \? \?/g, "s.categories::jsonb @> to_jsonb(?::text)");
  const rows = await contentDb.prepare(sql).all(...p, Math.min(50, limit));
  return shape(rows, viewerKey);
}

export async function getStory(id, viewerKey = null) {
  await publishDue();
  const r = await contentDb.prepare("SELECT * FROM stories WHERE id = ?").get(id);
  if (!r) return null;
  const own = viewerKey && r.anonymous_id === viewerKey;
  if (r.status !== "published" && !own) return null;
  const [story] = await shape([r], viewerKey, { full: true });
  story.status = r.status; story.isOwner = !!own; story.publishAt = r.publish_at || null;
  story.updates = (await contentDb.prepare("SELECT id, kind, body, event_on AS \"eventOn\", created_at AS \"createdAt\" FROM story_updates WHERE story_id = ? ORDER BY created_at ASC").all(id))
    .map((u) => ({ ...u, time: formatRelativeTime(u.createdAt) }));
  story.evidence = (await contentDb.prepare("SELECT id, kind, label, created_at AS \"createdAt\" FROM story_evidence WHERE story_id = ? ORDER BY created_at").all(id));
  story.responses = (await contentDb.prepare(
    "SELECT r.id, r.kind, r.body, r.created_at AS \"createdAt\", c.name AS \"companyName\" FROM company_responses r JOIN companies c ON c.id = r.company_id WHERE r.story_id = ? ORDER BY r.created_at"
  ).all(id)).map((x) => ({ ...x, time: formatRelativeTime(x.createdAt) }));
  story.rooms = (await contentDb.prepare("SELECT id, topic FROM rooms WHERE story_id = ? AND status = 'live' ORDER BY created_at DESC LIMIT 3").all(id).catch(() => []));
  story.timeline = buildStoryTimeline(story);
  story.related = await relatedStories(r, viewerKey);
  story.pattern = await patternForStory(r);
  if (own) {
    story.redactions = J(r.redactions, {});
    story.identity = identityRisk({ mode: r.mode, company: r.company_name, department: r.department, location: r.location, roleTitle: r.role_title, tenure: r.tenure, period: r.period, text: r.body });
  }
  return story;
}

function buildStoryTimeline(s) {
  const items = [];
  if (s.happenedOn || s.period) items.push({ at: s.happenedOn || s.createdAt, label: s.period || s.happenedOn, text: "What happened", kind: "incident" });
  items.push({ at: s.createdAt, label: new Date(s.createdAt).toISOString().slice(0, 10), text: "Story shared", kind: "posted" });
  for (const u of s.updates) items.push({ at: u.eventOn || u.createdAt, label: (u.eventOn || u.createdAt).slice(0, 10), text: u.body, kind: u.kind });
  for (const r of s.responses) items.push({ at: r.createdAt, label: r.createdAt.slice(0, 10), text: `${r.companyName} responded`, kind: "response" });
  return items.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

async function relatedStories(r, viewerKey) {
  const cats = J(r.categories, []);
  const rows = await contentDb.prepare(
    `SELECT * FROM stories WHERE status = 'published' AND id <> ? AND (
        (company_key IS NOT NULL AND company_key = ?)
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(categories::jsonb) c WHERE c = ANY (?::text[])))
     ORDER BY (CASE WHEN company_key = ? THEN 0 ELSE 1 END), created_at DESC LIMIT 4`
  ).all(r.id, r.company_key || "", cats, r.company_key || "");
  const shaped = await shape(rows, viewerKey);
  return shaped.map((s) => ({ id: s.id, title: s.title, formatLabel: s.formatLabel, company: s.company, time: s.time, excerpt: s.body.slice(0, 140), sameCompany: !!r.company_key && norm(s.company) === r.company_key }));
}

// "Pattern detected" for a story: other independent reports (90d) sharing a theme at the same company.
async function patternForStory(r) {
  if (!r.company_key) return null;
  const themes = rowThemes(r).filter((k) => k !== "positive");
  if (!themes.length) return null;
  const since = new Date(Date.now() - 90 * DAY).toISOString();
  const rows = await contentDb.prepare("SELECT anonymous_id, title, body, told, actual, impact, themes FROM stories WHERE status='published' AND company_key = ? AND created_at > ?").all(r.company_key, since);
  for (const t of themes) {
    const authors = new Set(rows.filter((x) => rowThemes(x).includes(t)).map((x) => x.anonymous_id));
    if (authors.size >= 5) return { theme: t, count: authors.size, text: `Emerging workplace pattern. ${patternLine(t, authors.size, 90)}`, note: "Independent reports from different accounts. This is a pattern in what people reported, not a finding about the company." };
  }
  return null;
}

// ---------------------------------------------------------------- interactions

// "This happened to me too" — toggles. kind: same | similar. Returns the fresh breakdown.
export async function setMeToo(storyId, viewerKey, { kind = "same", sameCompany = false } = {}) {
  const s = await contentDb.prepare("SELECT id, anonymous_id, status FROM stories WHERE id = ?").get(storyId);
  if (!s || s.status !== "published") throw new StoryError("Story not found.", 404, "NOT_FOUND");
  if (s.anonymous_id === viewerKey) throw new StoryError("This is your own story.", 400, "OWN_STORY");
  const k = kind === "similar" ? "similar" : kind === "off" ? "off" : "same";
  if (k === "off") await contentDb.prepare("DELETE FROM story_me_too WHERE story_id = ? AND anon_key = ?").run(storyId, viewerKey);
  else await contentDb.prepare(
    `INSERT INTO story_me_too (story_id, anon_key, kind, same_company, created_at) VALUES (?,?,?,?,?)
     ON CONFLICT (story_id, anon_key) DO UPDATE SET kind = EXCLUDED.kind, same_company = EXCLUDED.same_company`
  ).run(storyId, viewerKey, k, sameCompany ? 1 : 0, nowIso());
  return meTooBreakdown(storyId, viewerKey, s.anonymous_id);
}

export async function meTooBreakdown(storyId, viewerKey = null, authorKey = null) {
  const rows = await contentDb.prepare("SELECT kind, same_company, COUNT(*) n FROM story_me_too WHERE story_id = ? GROUP BY kind, same_company").all(storyId);
  let same = 0, similar = 0, sameCompany = 0;
  for (const r of rows) { const n = Number(r.n); if (r.kind === "same") same += n; else similar += n; if (Number(r.same_company)) sameCompany += n; }
  const mine = viewerKey ? (await contentDb.prepare("SELECT kind FROM story_me_too WHERE story_id = ? AND anon_key = ?").get(storyId, viewerKey))?.kind || null : null;
  return { sameHere: same, similar, total: same + similar, sameCompany, otherCompanies: same + similar - sameCompany, mine };
}

export async function addUpdate(storyId, ownerKey, { kind = "update", body, eventOn }) {
  const s = await contentDb.prepare("SELECT anonymous_id FROM stories WHERE id = ?").get(storyId);
  if (!s) throw new StoryError("Story not found.", 404, "NOT_FOUND");
  if (s.anonymous_id !== ownerKey) throw new StoryError("Only the author can update a story.", 403, "NOT_OWNER");
  const k = ["update", "correction", "milestone"].includes(kind) ? kind : "update";
  const { values } = redactFields({ body: clip(body, 2000) });
  if (values.body.length < 3) throw new StoryError("Write the update first.");
  const on = /^\d{4}-\d{2}-\d{2}$/.test(eventOn || "") ? eventOn : null;
  const text = k === "correction" && !/^correction/i.test(values.body) ? `Correction: ${values.body}` : values.body;
  await contentDb.prepare("INSERT INTO story_updates (id, story_id, kind, body, event_on, created_at) VALUES (?,?,?,?,?,?)").run(crypto.randomUUID(), storyId, k, text, on, nowIso());
  await contentDb.prepare("UPDATE stories SET updated_at = ? WHERE id = ?").run(nowIso(), storyId);
  import("./alerts.js").then((m) => m.notifyFollowersOfUpdate(storyId, k)).catch(() => {});
  return getStory(storyId, ownerKey);
}

export async function setOutcome(storyId, ownerKey, outcome) {
  if (!validKey(OUTCOMES, outcome)) throw new StoryError("Unknown outcome.");
  const n = await contentDb.prepare("UPDATE stories SET outcome = ?, updated_at = ? WHERE id = ? AND anonymous_id = ?").run(outcome, nowIso(), storyId, ownerKey);
  if (!n.changes) throw new StoryError("Only the author can change the outcome.", 403, "NOT_OWNER");
  return getStory(storyId, ownerKey);
}

export async function deleteStory(storyId, ownerKey) {
  const ev = await contentDb.prepare("SELECT file_key FROM story_evidence WHERE story_id = ?").all(storyId);
  const n = await contentDb.prepare("DELETE FROM stories WHERE id = ? AND anonymous_id = ?").run(storyId, ownerKey);
  if (!n.changes) throw new StoryError("Only the author can delete a story.", 403, "NOT_OWNER");
  try { const { deletePrivateObject } = await import("../storage.js"); for (const e of ev) if (e.file_key) await deletePrivateObject(e.file_key).catch(() => {}); } catch { /* storage not configured */ }
  for (const t of ["story_me_too", "story_updates", "story_evidence", "story_follows", "company_responses", "story_disputes"]) await contentDb.prepare(`DELETE FROM ${t} WHERE story_id = ?`).run(storyId);
  return { ok: true };
}

export async function addEvidence(storyId, ownerKey, { kind, label, fileKey, contentType, sizeBytes }) {
  const s = await contentDb.prepare("SELECT anonymous_id FROM stories WHERE id = ?").get(storyId);
  if (!s || s.anonymous_id !== ownerKey) throw new StoryError("Only the author can attach evidence.", 403, "NOT_OWNER");
  const n = Number((await contentDb.prepare("SELECT COUNT(*) n FROM story_evidence WHERE story_id = ?").get(storyId)).n);
  if (n >= 8) throw new StoryError("A story can have up to 8 pieces of evidence.");
  const id = crypto.randomUUID();
  await contentDb.prepare("INSERT INTO story_evidence (id, story_id, kind, label, file_key, content_type, size_bytes, created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(id, storyId, kind, redactFields({ l: clip(label, 100) }).values.l || null, fileKey || null, contentType || null, sizeBytes || null, nowIso());
  return { id };
}

export async function toggleFollowStory(storyId, viewerKey, limitFree = null) {
  const have = await contentDb.prepare("SELECT 1 x FROM story_follows WHERE story_id = ? AND anon_key = ?").get(storyId, viewerKey);
  if (have) { await contentDb.prepare("DELETE FROM story_follows WHERE story_id = ? AND anon_key = ?").run(storyId, viewerKey); return { following: false }; }
  if (limitFree != null) {
    const n = Number((await contentDb.prepare("SELECT COUNT(*) n FROM story_follows WHERE anon_key = ?").get(viewerKey)).n);
    if (n >= limitFree) throw new StoryError(`You can track ${limitFree} stories on your plan. Upgrade to OUT+ to track more.`, 403, "PLAN_LIMIT");
  }
  await contentDb.prepare("INSERT INTO story_follows (story_id, anon_key, created_at) VALUES (?,?,?)").run(storyId, viewerKey, nowIso());
  return { following: true };
}

export async function followersOf(storyId) {
  return (await contentDb.prepare("SELECT anon_key FROM story_follows WHERE story_id = ?").all(storyId)).map((r) => r.anon_key);
}

export async function myStories(ownerKeys, viewerKey) {
  if (!ownerKeys.length) return [];
  const ph = ownerKeys.map(() => "?").join(",");
  const rows = await contentDb.prepare(`SELECT * FROM stories WHERE anonymous_id IN (${ph}) ORDER BY created_at DESC LIMIT 100`).all(...ownerKeys);
  const shaped = await shape(rows, viewerKey);
  return shaped.map((s, i) => ({ ...s, status: rows[i].status, publishAt: rows[i].publish_at || null }));
}

export async function fileDispute({ storyId, reporterKey, role, reason, details }) {
  const s = await contentDb.prepare("SELECT id FROM stories WHERE id = ?").get(storyId);
  if (!s) throw new StoryError("Story not found.", 404, "NOT_FOUND");
  if (!["mentioned", "company", "other"].includes(role)) role = "other";
  const r = clip(reason, 200); if (r.length < 5) throw new StoryError("Tell us what's wrong in a sentence.");
  await contentDb.prepare("INSERT INTO story_disputes (id, story_id, reporter_key, role, reason, details, created_at) VALUES (?,?,?,?,?,?,?)")
    .run(crypto.randomUUID(), storyId, reporterKey || null, role, r, clip(details, 2000) || null, nowIso());
  return { ok: true };
}

// ---------------------------------------------------------------- circles

export async function ensureCircles() {
  for (const c of DEFAULT_CIRCLES) {
    await contentDb.prepare("INSERT INTO circles (id, slug, name, description, created_at, official) VALUES (?,?,?,?,?,1) ON CONFLICT (slug) DO NOTHING")
      .run(crypto.randomUUID(), c.slug, c.name, c.description, nowIso());
  }
}
export async function listCircles(viewerKey) {
  await ensureCircles();
  const rows = await contentDb.prepare(
    `SELECT c.id, c.slug, c.name, c.description,
       (SELECT COUNT(*) FROM circle_members m WHERE m.circle_id = c.id) AS members,
       (SELECT COUNT(*) FROM stories s WHERE s.circle_id = c.id AND s.status = 'published') AS stories
     FROM circles c ORDER BY members DESC, c.name`
  ).all();
  const mine = viewerKey ? new Set((await contentDb.prepare("SELECT circle_id FROM circle_members WHERE anon_key = ?").all(viewerKey)).map((r) => r.circle_id)) : new Set();
  return rows.map((r) => ({ ...r, members: Number(r.members), stories: Number(r.stories), joined: mine.has(r.id) }));
}
export async function toggleCircle(slug, viewerKey) {
  const c = await contentDb.prepare("SELECT id FROM circles WHERE slug = ?").get(slug);
  if (!c) throw new StoryError("Circle not found.", 404, "NOT_FOUND");
  const have = await contentDb.prepare("SELECT 1 x FROM circle_members WHERE circle_id = ? AND anon_key = ?").get(c.id, viewerKey);
  if (have) await contentDb.prepare("DELETE FROM circle_members WHERE circle_id = ? AND anon_key = ?").run(c.id, viewerKey);
  else await contentDb.prepare("INSERT INTO circle_members (circle_id, anon_key, created_at) VALUES (?,?,?)").run(c.id, viewerKey, nowIso());
  return { joined: !have };
}

// ---------------------------------------------------------------- statistics

export async function platformStats() {
  const since = new Date(Date.now() - 365 * DAY).toISOString();
  const rows = await contentDb.prepare("SELECT format, COUNT(DISTINCT anonymous_id) n FROM stories WHERE status='published' AND created_at > ? GROUP BY format").all(since);
  const by = Object.fromEntries(rows.map((r) => [r.format, Number(r.n)]));
  const total = Number((await contentDb.prepare("SELECT COUNT(*) n FROM stories WHERE status='published'").get()).n);
  const salaryDisc = Number((await contentDb.prepare("SELECT COUNT(*) n FROM stories WHERE status='published' AND format = 'salary' AND (details::jsonb ->> 'offered') IS NOT NULL AND (details::jsonb ->> 'advertised') IS NOT NULL").get()).n);
  return { totalStories: total, windowDays: 365, laidOff: by.laid_off || 0, ghosted: by.ghosted || 0, interviews: by.interview || 0, salaryDiscrepancies: salaryDisc, redFlags: by.red_flag || 0, greenFlags: by.green_flag || 0,
    note: "Counts of distinct accounts that shared a Story of that type in the last 12 months on LinkedOut. These are user reports, not a survey of the workforce." };
}

export async function workplaceTrends() {
  const cur = new Date(Date.now() - 90 * DAY).toISOString(); const prev = new Date(Date.now() - 180 * DAY).toISOString();
  const rows = await contentDb.prepare("SELECT created_at, title, body, told, actual, impact, themes FROM stories WHERE status='published' AND created_at > ?").all(prev);
  const count = (key, from, to) => rows.filter((r) => r.created_at > from && r.created_at <= to && rowThemes(r).includes(key)).length;
  const out = [];
  for (const t of THEMES) {
    if (t.key === "positive") continue;
    const a = count(t.key, cur, nowIso()); const b = count(t.key, prev, cur);
    if (a + b < 5) continue;
    out.push({ key: t.key, label: t.label, current: a, previous: b, changePct: b ? Math.round(((a - b) / b) * 100) : null });
  }
  return { trends: out.sort((x, y) => y.current - x.current), method: "Share of Stories mentioning each theme in the last 90 days vs the 90 days before. Themes are matched by plain keyword rules; counts are of Stories, not of workers." };
}

// ---------------------------------------------------------------- layoff tracker

export async function layoffTracker({ days = 365, limit = 30, q = null } = {}) {
  const since = new Date(Date.now() - days * DAY).toISOString();
  const rows = await contentDb.prepare(
    `SELECT company_key, MAX(company_name) AS company_name, MAX(company_id) AS company_id,
            COUNT(*) AS stories, COUNT(DISTINCT anonymous_id) AS reporters,
            SUM(CASE WHEN verified_employment = 1 THEN 1 ELSE 0 END) AS verified,
            MIN(COALESCE(happened_on, created_at)) AS first_on, MAX(COALESCE(happened_on, created_at)) AS last_on
     FROM stories WHERE status='published' AND format = 'laid_off' AND company_key IS NOT NULL AND created_at > ?
       ${q ? "AND company_name ILIKE ?" : ""}
     GROUP BY company_key ORDER BY reporters DESC, last_on DESC LIMIT ?`
  ).all(...[since, ...(q ? [`%${q.replace(/[%_]/g, "")}%`] : []), Math.min(100, limit)]);
  const out = [];
  for (const r of rows) {
    const items = await contentDb.prepare("SELECT department, location, details FROM stories WHERE status='published' AND format='laid_off' AND company_key = ? AND created_at > ?").all(r.company_key, since);
    const depts = tally(items.map((i) => i.department)); const locs = tally(items.map((i) => i.location));
    const est = items.map((i) => Number(J(i.details, {}).companyWide)).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
    const records = await contentDb.prepare("SELECT id, headcount, summary, source_name, source_url, occurred_on FROM public_records WHERE company_key = ? AND kind = 'layoff' ORDER BY occurred_on DESC NULLS LAST").all(r.company_key);
    out.push({
      company: r.company_name, companyId: r.company_id || null, companyKey: r.company_key,
      userReported: {
        label: "User-reported", reporters: Number(r.reporters), stories: Number(r.stories), verifiedEmployees: Number(r.verified),
        estimatedAffected: est.length ? est[Math.floor(est.length / 2)] : null, estimateBasis: est.length ? `Median of ${est.length} user estimate${est.length === 1 ? "" : "s"}` : null,
        departments: depts.slice(0, 6), locations: locs.slice(0, 6), firstReported: String(r.first_on).slice(0, 10), lastReported: String(r.last_on).slice(0, 10),
      },
      documented: records.length ? { label: "Publicly documented", records: records.map((x) => ({ id: x.id, headcount: x.headcount, summary: x.summary, source: x.source_name, url: x.source_url, date: x.occurred_on })) } : null,
    });
  }
  // Companies with a public record but no user reports yet still belong in the tracker.
  const onlyPublic = await contentDb.prepare(
    `SELECT company_key, id, headcount, summary, source_name, source_url, occurred_on FROM public_records
     WHERE kind='layoff' AND occurred_on > ? AND company_key NOT IN (SELECT DISTINCT company_key FROM stories WHERE format='laid_off' AND company_key IS NOT NULL)`
  ).all(since.slice(0, 10));
  for (const x of onlyPublic) {
    const c = await contentDb.prepare("SELECT id, name FROM companies WHERE name_norm = ?").get(x.company_key);
    out.push({ company: c?.name || x.company_key, companyId: c?.id || null, companyKey: x.company_key, userReported: null,
      documented: { label: "Publicly documented", records: [{ id: x.id, headcount: x.headcount, summary: x.summary, source: x.source_name, url: x.source_url, date: x.occurred_on }] } });
  }
  return {
    companies: out,
    legend: { "User-reported": "Shared by LinkedOut users about their own experience. Not independently confirmed.", "Publicly documented": "Backed by a public source we link to." },
  };
}
function tally(vals) {
  const m = new Map();
  for (const v of vals) { const k = (v || "").trim(); if (k) m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n }));
}

export async function addPublicRecord({ companyName, kind = "layoff", headcount, summary, sourceName, sourceUrl, occurredOn, addedBy }) {
  if (!companyName || !summary || !sourceName || !/^https?:\/\//.test(sourceUrl || "")) throw new StoryError("Company, summary, source name and a source link are required.");
  const key = norm(companyName);
  const c = await contentDb.prepare("SELECT id FROM companies WHERE name_norm = ?").get(key);
  const id = crypto.randomUUID();
  await contentDb.prepare("INSERT INTO public_records (id, company_id, company_key, kind, headcount, summary, source_name, source_url, occurred_on, added_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, c?.id || null, key, kind === "layoff" ? "layoff" : "other", Number.isFinite(Number(headcount)) ? Number(headcount) : null, clip(summary, 400), clip(sourceName, 100), sourceUrl.slice(0, 500), /^\d{4}-\d{2}-\d{2}$/.test(occurredOn || "") ? occurredOn : null, addedBy || null, nowIso());
  return { id };
}

// ---------------------------------------------------------------- company reality

export async function companyReality(companyId, { viewerKey = null, tier = "basic" } = {}) {
  const c = await contentDb.prepare("SELECT id, name, industry, status, owner_key, verification, domain_verified FROM companies WHERE id = ?").get(companyId);
  if (!c || c.status !== "active") return null;
  const key = norm(c.name);
  const all = await contentDb.prepare("SELECT * FROM stories WHERE status='published' AND (company_id = ? OR company_key = ?) ORDER BY created_at DESC").all(companyId, key);
  const txt = (r) => `${r.title || ""} ${r.body} ${r.told || ""} ${r.actual || ""}`;
  const d90 = Date.now() - 90 * DAY;
  const recent = all.filter((r) => new Date(r.created_at).getTime() > d90);
  const distinct = (rows) => new Set(rows.map((r) => r.anonymous_id)).size;

  const counts = { stories: all.length, reporters: distinct(all), current: distinct(all.filter((r) => r.employment_claim === "current")), former: distinct(all.filter((r) => r.employment_claim === "former")) };
  const byFormat = tally(all.map((r) => STORY_FORMATS.find((f) => f.key === r.format)?.label));

  // Patterns (threshold of 5 independent reports within 90 days).
  const patterns = [];
  for (const t of THEMES) {
    if (t.key === "positive") continue;
    const rs = recent.filter((r) => rowThemes(r).includes(t.key));
    const n = distinct(rs);
    if (n >= 5) patterns.push({ theme: t.key, count: n, text: patternLine(t.key, n, 90), storyIds: rs.slice(0, 6).map((r) => r.id) });
  }
  patterns.sort((a, b) => b.count - a.count);

  // Why people left.
  const leavers = all.filter((r) => J(r.leave_reasons, []).length);
  const leaveTally = tally(leavers.flatMap((r) => J(r.leave_reasons, [])));
  const leaving = { responses: leavers.length, breakdown: leavers.length >= 5 ? leaveTally.map((x) => ({ reason: x.name, pct: Math.round((x.n / leavers.reduce((s, r) => s + J(r.leave_reasons, []).length, 0)) * 100) })) : [], note: leavers.length >= 5 ? null : "Shown once at least 5 people have said why they left." };

  // Interview reality.
  const iv = all.filter((r) => ["interview", "ghosted"].includes(r.format));
  const rounds = iv.map((r) => Number(J(r.details, {}).rounds)).filter((n) => n > 0 && n < 20);
  const interviews = {
    stories: iv.length,
    avgRounds: rounds.length >= 3 ? Math.round((rounds.reduce((a, b) => a + b, 0) / rounds.length) * 10) / 10 : null,
    ghosted: distinct(all.filter((r) => r.format === "ghosted")),
    ghostStages: tally(all.filter((r) => r.format === "ghosted").map((r) => J(r.details, {}).stage)),
  };

  // Salary promised vs received.
  const sal = all.filter((r) => r.format === "salary").map((r) => J(r.details, {})).filter((d) => Number(d.advertised) > 0 && Number(d.final) > 0);
  const salary = { reports: sal.length, gapPct: sal.length >= 3 ? Math.round((sal.reduce((s, d) => s + (Number(d.final) - Number(d.advertised)) / Number(d.advertised), 0) / sal.length) * 100) : null,
    note: sal.length >= 3 ? "Average difference between advertised and final pay in user reports." : "Shown once at least 3 people have reported advertised and final pay." };

  // Flags.
  const flagTally = (fmt) => tally(all.filter((r) => r.format === fmt).map((r) => J(r.details, {}).flag || r.title)).slice(0, 8);
  const flags = { red: flagTally("red_flag"), green: flagTally("green_flag") };
  const notInJd = all.filter((r) => r.format === "not_in_jd").flatMap((r) => J(r.details, {}).missing || []);
  const jdVsReality = all.filter((r) => r.format === "jd_reality").slice(0, 4).map((r) => ({ id: r.id, role: r.role_title, said: J(r.details, {}).posting, reality: J(r.details, {}).reality }));

  // Exit waves.
  const leftNow = distinct(all.filter((r) => ["quit", "fired", "laid_off"].includes(r.format) && new Date(r.created_at).getTime() > d90));
  const leftBefore = distinct(all.filter((r) => ["quit", "fired", "laid_off"].includes(r.format) && new Date(r.created_at).getTime() <= d90 && new Date(r.created_at).getTime() > Date.now() - 180 * DAY));
  const exitWave = leftNow >= 5 && leftNow >= leftBefore * 2 ? { label: "Potential departure trend", text: `${leftNow} people reported leaving in the last 90 days, up from ${leftBefore} in the 90 days before. This reflects what users reported, not a count of everyone who left.` } : null;

  // Workplace Index: bars only when there is enough data (min 8 stories), always with methodology.
  const idxTheme = { Transparency: ["unclear", "broken_promise"], Management: ["intimidation", "unclear", "discrimination", "harassment"], "Pay fairness": ["unpaid_wages", "salary_change"], "Work-life balance": ["unpaid_ot", "burnout", "rto"], "Layoff risk": ["layoffs", "hiring_freeze"] };
  const enough = all.length >= 8;
  const index = {
    ready: enough,
    rows: enough ? Object.entries(idxTheme).map(([label, ts]) => {
      const mentions = all.filter((r) => ts.some((t) => rowThemes(r).includes(t))).length;
      const share = mentions / all.length;
      // For "Layoff risk", a higher bar means MORE risk reported; for the rest higher = better.
      const better = Math.max(0, Math.min(10, Math.round(10 - share * 20)));
      return { label, value: label === "Layoff risk" ? Math.min(10, Math.round(share * 20)) : better, higherIsWorse: label === "Layoff risk", mentions };
    }) : [],
    methodology: "Each bar reflects the share of this company's Stories that mention related issues (plain keyword rules, see methodology). It is a summary of what users shared, it moves as more people share, and it is not a rating of the company. It appears once a company has at least 8 Stories.",
  };

  // Ask before you join — only from themes with at least 3 independent reports in the last year.
  const ask = [];
  for (const t of THEMES) {
    const ASK = ASK_BEFORE_JOINING[t.key]; if (!ASK) continue;
    const n = distinct(all.filter((r) => rowThemes(r).includes(t.key)));
    if (n >= 3) ask.push({ theme: t.key, reports: n, question: ASK, basis: `${n} ${n === 1 ? "person" : "people"} mentioned ${t.label}.` });
  }
  ask.sort((a, b) => b.reports - a.reports);

  // Positive vs negative balance.
  const positiveN = distinct(all.filter((r) => r.format === "green_flag" || rowThemes(r).includes("positive")));
  const concerns = patterns.slice(0, 3).map((p) => p.text);

  // Claims + Truth Gap.
  const claims = await contentDb.prepare("SELECT * FROM company_claims WHERE company_id = ? ORDER BY created_at DESC LIMIT 12").all(companyId);
  const claimOut = [];
  for (const cl of claims) {
    const checks = await contentDb.prepare("SELECT verdict, COUNT(*) n FROM claim_checks WHERE claim_id = ? GROUP BY verdict").all(cl.id);
    const v = Object.fromEntries(checks.map((x) => [x.verdict, Number(x.n)]));
    const topic = CLAIM_TOPICS[cl.topic];
    const neg = topic ? distinct(all.filter((r) => topic.negative.some((t) => rowThemes(r).includes(t)) && new Date(r.created_at).getTime() > Date.now() - 365 * DAY)) : 0;
    const pos = topic ? distinct(all.filter((r) => r.format === "green_flag" && (J(r.categories, []).includes("Workplace success") || rowThemes(r).includes("positive")))) : 0;
    const voted = (v.matches || 0) + (v.mixed || 0) + (v.differs || 0);
    const signal = neg + (v.differs || 0); const support = pos + (v.matches || 0);
    let gap = "not_enough"; if (signal + support + (v.mixed || 0) >= 3) { const r = signal / Math.max(1, signal + support); gap = r > 0.66 ? "differs" : r < 0.34 ? "aligned" : "mixed"; }
    claimOut.push({ id: cl.id, topic: cl.topic, claim: cl.claim, source: cl.source, time: formatRelativeTime(cl.created_at), checks: { matches: v.matches || 0, mixed: v.mixed || 0, differs: v.differs || 0, total: voted },
      truthGap: { status: gap, label: { aligned: "Reports broadly match the claim", mixed: "Mixed reports", differs: "Reports differ from the claim", not_enough: "Not enough reports yet" }[gap], recentReports: neg, topicLabel: topic?.label || null } });
  }

  // Right of reply / company statements.
  const explanations = (await contentDb.prepare("SELECT id, body, created_at FROM company_responses WHERE company_id = ? AND kind = 'explanation' ORDER BY created_at DESC LIMIT 10").all(companyId))
    .map((r) => ({ id: r.id, body: r.body, date: r.created_at.slice(0, 10) }));
  const replies = Number((await contentDb.prepare("SELECT COUNT(*) n FROM company_responses WHERE company_id = ? AND kind = 'reply'").get(companyId)).n);

  // Timeline: monthly signals + public records + the company's own explanations.
  const timeline = await buildCompanyTimeline({ all, key, explanations, txt });

  // Layoffs for this company.
  const layoffRows = all.filter((r) => r.format === "laid_off");
  const records = await contentDb.prepare("SELECT headcount, summary, source_name, source_url, occurred_on FROM public_records WHERE company_key = ? ORDER BY occurred_on DESC NULLS LAST").all(key);
  const layoffs = { userReported: { reporters: distinct(layoffRows), departments: tally(layoffRows.map((r) => r.department)).slice(0, 6), locations: tally(layoffRows.map((r) => r.location)).slice(0, 6) }, documented: records.map((x) => ({ headcount: x.headcount, summary: x.summary, source: x.source_name, url: x.source_url, date: x.occurred_on })) };

  const isOwner = !!viewerKey && c.owner_key === viewerKey;
  return {
    company: { id: c.id, name: c.name, industry: c.industry, verified: c.verification === "verified", verifiedRep: isOwner },
    counts, byFormat, patterns, layoffs, leaving, interviews, salary, flags, notInJd: tally(notInJd).slice(0, 10), jdVsReality,
    exitWave, index, askBeforeJoining: ask.slice(0, 6), positives: { reports: positiveN }, concerns,
    claims: claimOut, responses: { replies, explanations }, timeline,
    methodology: "Everything on this page is built from Stories people chose to share. Reports are first-hand and have not been independently verified unless a label says so. Patterns need at least 5 independent reports within 90 days. Nothing here states that a company has done anything.",
    advanced: tier !== "basic",
  };
}

async function buildCompanyTimeline({ all, key, explanations, txt }) {
  const items = [];
  const byMonth = new Map();
  for (const r of all) {
    const m = String(r.happened_on || r.created_at).slice(0, 7);
    (byMonth.get(m) || byMonth.set(m, []).get(m)).push(r);
  }
  const verbs = { layoffs: "report layoffs", rto: "report return-to-office changes", hiring_freeze: "report a hiring freeze", unpaid_wages: "report late or unpaid wages", salary_change: "report pay changing after an offer", unpaid_ot: "report heavy after-hours work" };
  for (const [m, rs] of [...byMonth.entries()].sort()) {
    for (const [t, verb] of Object.entries(verbs)) {
      const n = new Set(rs.filter((r) => rowThemes(r).includes(t)).map((r) => r.anonymous_id)).size;
      if (n >= 2) items.push({ at: `${m}-15`, month: m, kind: "reports", text: `${n} users ${verb}.` });
    }
    const pos = new Set(rs.filter((r) => r.format === "green_flag" || rowThemes(r).includes("positive")).map((r) => r.anonymous_id)).size;
    if (pos >= 3) items.push({ at: `${m}-15`, month: m, kind: "positive", text: `${pos} users share positive experiences.` });
  }
  for (const x of await contentDb.prepare("SELECT headcount, summary, source_name, source_url, occurred_on FROM public_records WHERE company_key = ?").all(key)) {
    if (x.occurred_on) items.push({ at: x.occurred_on, month: x.occurred_on.slice(0, 7), kind: "public", text: x.summary, source: x.source_name, url: x.source_url });
  }
  for (const e of explanations) items.push({ at: e.date, month: e.date.slice(0, 7), kind: "company", text: `Company statement: ${e.body.slice(0, 200)}` });
  return items.sort((a, b) => a.at.localeCompare(b.at));
}

// ---------------------------------------------------------------- claims & replies

export async function addClaim({ companyId, topic, claim, submittedBy, source = "user" }) {
  const c = await contentDb.prepare("SELECT id FROM companies WHERE id = ? AND status='active'").get(companyId);
  if (!c) throw new StoryError("Company not found.", 404, "NOT_FOUND");
  const text = clip(claim, 300); if (text.length < 8) throw new StoryError("Quote the claim the company makes.");
  const t = CLAIM_TOPICS[topic] ? topic : null;
  const id = crypto.randomUUID();
  await contentDb.prepare("INSERT INTO company_claims (id, company_id, topic, claim, source, submitted_by, created_at) VALUES (?,?,?,?,?,?,?)").run(id, companyId, t, text, source, submittedBy || null, nowIso());
  return { id };
}

export async function addClaimCheck({ claimId, anonymousId, authorDisplay, verdict, body }) {
  if (!["matches", "mixed", "differs"].includes(verdict)) throw new StoryError("Pick whether it matches, is mixed, or differs.");
  const cl = await contentDb.prepare("SELECT id FROM company_claims WHERE id = ?").get(claimId);
  if (!cl) throw new StoryError("Claim not found.", 404, "NOT_FOUND");
  await contentDb.prepare(
    `INSERT INTO claim_checks (id, claim_id, anonymous_id, author_display, verdict, body, created_at) VALUES (?,?,?,?,?,?,?)
     ON CONFLICT (claim_id, anonymous_id) DO UPDATE SET verdict = EXCLUDED.verdict, body = EXCLUDED.body`
  ).run(crypto.randomUUID(), claimId, anonymousId, authorDisplay, verdict, redactFields({ b: clip(body, 600) }).values.b || null, nowIso());
  return { ok: true };
}

export async function listClaimChecks(claimId) {
  return (await contentDb.prepare("SELECT author_display AS author, verdict, body, created_at AS \"createdAt\" FROM claim_checks WHERE claim_id = ? ORDER BY created_at DESC LIMIT 30").all(claimId))
    .map((r) => ({ ...r, time: formatRelativeTime(r.createdAt) }));
}

// Only a company's verified owner can reply. Replies sit beside the story; they never replace it.
export async function addCompanyResponse({ companyId, ownerKey, storyId = null, kind = "reply", body }) {
  const c = await contentDb.prepare("SELECT owner_key, verification FROM companies WHERE id = ? AND status='active'").get(companyId);
  if (!c) throw new StoryError("Company not found.", 404, "NOT_FOUND");
  const isRep = c.owner_key !== ownerKey && !!(await contentDb.prepare("SELECT 1 x FROM company_reps WHERE company_id = ? AND anon_key = ?").get(companyId, ownerKey));
  if (c.owner_key !== ownerKey && !isRep) throw new StoryError("Only the company's page owner or its representatives can respond.", 403, "NOT_OWNER");
  if (c.verification !== "verified") throw new StoryError("Your company page needs to be verified before you can respond publicly.", 403, "NOT_VERIFIED");
  const text = clip(body, 2000); if (text.length < 10) throw new StoryError("Write a response of at least a sentence.");
  if (storyId) {
    const s = await contentDb.prepare("SELECT id FROM stories WHERE id = ? AND status='published' AND (company_id = ? OR company_key = (SELECT name_norm FROM companies WHERE id = ?))").get(storyId, companyId, companyId);
    if (!s) throw new StoryError("That story isn't about your company.", 400, "WRONG_COMPANY");
  }
  const id = crypto.randomUUID();
  await contentDb.prepare("INSERT INTO company_responses (id, company_id, story_id, kind, body, responder_key, created_at) VALUES (?,?,?,?,?,?,?)")
    .run(id, companyId, storyId, storyId ? "reply" : "explanation", text, ownerKey, nowIso());
  return { id };
}

// Companies Stories mention that someone may want to link to. Used by composer autocomplete.
export async function suggestCompanies(q) {
  const l = `%${String(q || "").replace(/[%_]/g, "").trim()}%`;
  if (l.length < 3) return [];
  return contentDb.prepare("SELECT id, name, industry FROM companies WHERE status='active' AND name ILIKE ? ORDER BY name LIMIT 8").all(l);
}

export { norm as normCompany };
