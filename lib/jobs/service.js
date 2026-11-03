// Jobs: discovery, the job page, and everything a candidate does. Company-side tools are in ./company.js.
//
// Model: Company ↔ Job ↔ Stories are one system. A job belongs to a company ENTITY (company_id); what people report about
// that company is shown on the job as "Before you apply", as aggregates with sample sizes, never as a verdict.
//   official job     posted/confirmed by an authorised representative            ✓ Verified
//   community job    posted by a LinkedOut user                                   labelled, must apply on its own link
//   external job     imported from another source (staff only, source named)
// Applications are accepted INSIDE LinkedOut only for official jobs: a job nobody at the company controls has nobody to receive them.
import crypto from "node:crypto";
import { contentDb, formatRelativeTime } from "../content/db.js";
import { StoryError, normCompany } from "../stories/service.js";
import { redactFields } from "../stories/redact.js";
import { verifiedMap } from "../stories/verify.js";
import { companyCtx, planOf } from "../stories/business.js";
import { notifyRoles } from "../stories/company-alerts.js";
import { deliverWebhooks } from "../stories/company-extras.js";
import { signals, publicSignals, benchmarkFor } from "../stories/company-intel.js";
import * as M from "../stories/company-metrics.js";
import { THEMES } from "../stories/themes.js";
import { createNotification, resolveAliasAccountId } from "../identity/service.js";
import { encryptMessage, decryptMessage } from "../messaging/crypto.js";
import { JOBS_MAX, has } from "../business-features.js";
import * as L from "./logic.js";
import { surveyStats } from "./surveys.js";
import { activePromotedIds, countImpressions } from "./enterprise.js";

const nowIso = () => new Date().toISOString(), uid = () => crypto.randomUUID(), DAY = 864e5;
const clip = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const J = (v, f) => { try { const x = JSON.parse(v); return x ?? f; } catch { return f; } };
const list = (v, n = 20, len = 200) => (Array.isArray(v) ? v : String(v || "").split("\n")).map((x) => clip(String(x), len)).filter(Boolean).slice(0, n);
const num = (v) => { const n = Number(String(v ?? "").replace(/[, ]/g, "")); return Number.isFinite(n) && n > 0 ? n : null; };
const err = (m, s = 400, c = "BAD_REQUEST") => new StoryError(m, s, c);
// Every lifecycle change leaves a line in the job's own audit trail (staff read it on the admin job record).
export const jobLog = (jobId, actor, action, detail = null) => contentDb.prepare("INSERT INTO job_audit (id, job_id, actor, action, detail, created_at) VALUES (?,?,?,?,?,?)").run(uid(), jobId, actor, action, detail ? String(detail).slice(0, 300) : null, nowIso()).catch(() => {});

export const SOURCE_LABEL = {
  official: "Official company job",
  community: "Community opportunity: not posted by the company",
  external: "External listing",
};
export const VERIFICATION_LABEL = { verified: "Verified", associated: "Company-associated", community: "Community", external: "External", review: "Under review" };

// ------------------------------------------------------------------ row mapping
export function mapJob(r) {
  const j = { ...r };
  for (const k of ["locations", "responsibilities", "requirements", "preferred", "benefits", "skills", "hiring_process", "screening_questions"]) j[k] = J(r[k], []);
  j.salary_min = r.salary_min != null && r.salary_min !== "" ? Number(r.salary_min) : null; j.salary_max = r.salary_max != null && r.salary_max !== "" ? Number(r.salary_max) : null;
  return j;
}
const fmtMoney = (n) => Number(n).toLocaleString("en-US");
export function salaryText(j) {
  if (j.salary_min == null || j.salary_max == null) return null;
  return `${j.currency ? j.currency + " " : ""}${fmtMoney(j.salary_min)}–${fmtMoney(j.salary_max)}${j.salary_period ? ` / ${j.salary_period}` : ""}`;
}
async function companiesById(ids) {
  const u = [...new Set(ids.filter(Boolean))]; if (!u.length) return {};
  return Object.fromEntries((await contentDb.prepare("SELECT id, name, industry, verification FROM companies WHERE id = ANY(?) AND status = 'active'").all(u)).map((c) => [c.id, c]));
}
export function card(j, co, extra = {}) {
  const t = L.transparency(j);
  return { id: j.id, title: j.title, department: j.department, company: { id: j.company_id || null, name: co?.name || j.company_name, verified: co?.verification === "verified" },
    locations: j.locations, mode: j.workplace_mode, type: j.employment_type, seniority: j.seniority, salary: salaryText(j), transparency: { score: j.transparency || t.score, level: t.level },
    source: j.source, sourceLabel: SOURCE_LABEL[j.source], verification: j.verification, verificationLabel: VERIFICATION_LABEL[j.verification], awaitingCompany: !!j.awaiting_company,
    posted: formatRelativeTime(j.published_at || j.created_at), deadline: j.deadline, status: j.status, accepting: L.acceptingApplications(j), internalApply: j.application_method === "internal" && j.source === "official", ...extra };
}

// ------------------------------------------------------------------ posting
async function activeCount(companyId) { return Number((await contentDb.prepare("SELECT COUNT(*) n FROM jobs WHERE company_id = ? AND source = 'official' AND status IN ('published','paused','review')").get(companyId)).n); }
function clean(i) {
  const mode = L.WORK_MODES.includes(i.workplaceMode) ? i.workplaceMode : null, type = L.EMPLOYMENT_TYPES.includes(i.employmentType) ? i.employmentType : null;
  const smin = num(i.salaryMin), smax = num(i.salaryMax);
  if ((smin || smax) && (!smin || !smax || smax < smin)) throw err("Give both ends of the salary range, with the maximum at least the minimum.");
  const deadline = i.deadline ? new Date(i.deadline) : null; if (deadline && (isNaN(deadline) || deadline.getTime() < Date.now() - DAY)) throw err("The application deadline must be in the future.");
  const ext = clip(i.externalUrl, 500); if (ext && !/^https:\/\/[^\s]+$/.test(ext)) throw err("The application link must be a full https:// link.");
  const method = i.applicationMethod === "external" ? "external" : "internal";
  return {
    title: clip(i.title, 120), department: clip(i.department, 80) || null, seniority: L.SENIORITY.includes(i.seniority) ? i.seniority : null, employment_type: type, workplace_mode: mode,
    office_days: mode === "hybrid" && Number.isInteger(Number(i.officeDays)) && i.officeDays !== "" ? Math.max(0, Math.min(5, Number(i.officeDays))) : null,
    locations: list(i.locations, 6, 80), salary_min: smin, salary_max: smax, currency: smin ? clip(i.currency, 6).toUpperCase() || null : null, salary_period: smin && L.PERIODS.includes(i.salaryPeriod) ? i.salaryPeriod : null,
    bonus_equity: clip(i.bonusEquity, 200) || null, description: clip(i.description, 8000) || null, responsibilities: list(i.responsibilities, 15), requirements: list(i.requirements, 15),
    preferred: list(i.preferred, 10), benefits: list(i.benefits, 15, 120), skills: list(i.skills, 15, 40), hiring_process: list(i.hiringProcess, 8, 80),
    screening_questions: list(i.screeningQuestions, 5, 200), application_method: method, external_url: ext || null, deadline: deadline ? deadline.toISOString() : null,
    visa_sponsorship: i.visa ? 1 : 0, relocation: i.relocation ? 1 : 0, role_context: clip(i.roleContext, 600) || null,
  };
}
const COLS = ["title", "department", "seniority", "employment_type", "workplace_mode", "office_days", "locations", "salary_min", "salary_max", "currency", "salary_period", "bonus_equity", "description", "responsibilities", "requirements", "preferred", "benefits", "skills", "hiring_process", "screening_questions", "application_method", "external_url", "deadline", "visa_sponsorship", "relocation", "role_context"];
const JSONCOLS = new Set(["locations", "responsibilities", "requirements", "preferred", "benefits", "skills", "hiring_process", "screening_questions"]);
const dbVal = (k, v) => (JSONCOLS.has(k) ? JSON.stringify(v) : v);

// forWhom: my_company (official, needs jobs.post) | other_company (community, linked to a real company, awaiting its confirmation) | community
export async function createJob(v, input) {
  const forWhom = ["my_company", "other_company", "community"].includes(input.forWhom) ? input.forWhom : "community";
  const f = clean(input); if (f.title.length < 3) throw err("Give the job a title.");
  let company = null, source = "community", verification = "community", awaiting = 0, companyName = clip(input.companyName, 120);
  if (forWhom !== "community") {
    company = await contentDb.prepare("SELECT id, name, verification, status FROM companies WHERE id = ? AND status = 'active'").get(input.companyId);
    if (!company) throw err("Pick the company from LinkedOut's list. If it isn't there, post it as a community opportunity.", 404, "NOT_FOUND");
    companyName = company.name;
  }
  if (forWhom === "my_company") {
    const ctx = await companyCtx(company.id, v.key, "jobs.post");   // throws 403 unless a rep with the right role
    if (!ctx.verified) throw err("Verify your company page first, so a posting can be called official.", 403, "NOT_VERIFIED");
    if (await activeCount(company.id) >= JOBS_MAX[ctx.plan]) throw err(`Your plan allows ${JOBS_MAX[ctx.plan]} active jobs. Close one or upgrade.`, 403, "PLAN_LIMIT");
    source = "official"; verification = "verified";
    if (!f.description || f.description.length < 50) throw err("Describe the role in a few sentences.");
    if (f.application_method === "external" && !f.external_url) throw err("Add the link where people apply.");
  } else {
    // Community jobs: nobody at a company controls them, so people apply on the poster's link, not inside LinkedOut.
    f.application_method = "external"; if (!f.external_url) throw err("Add the link where people can apply. Community opportunities can't take applications inside LinkedOut.");
    const today = Number((await contentDb.prepare("SELECT COUNT(*) n FROM jobs WHERE created_by_key = ? AND source = 'community' AND created_at > ?").get(v.key, new Date(Date.now() - DAY).toISOString())).n);
    if (today >= 3) throw err("That's three community jobs today. Try again tomorrow.", 429, "RATE_LIMITED");
    if (!companyName) throw err("Say which company this is for.");
    if (forWhom === "other_company") {
      awaiting = 1;
      // Evidence the poster really is connected (a verified work-email at that company) upgrades "Community" to "Company-associated".
      const map = await verifiedMap(v.accountId).catch(() => ({})); if (map[normCompany(company.name)] === "current") verification = "associated";
    }
  }
  const signalsHit = source === "official" ? [] : L.scamSignals({ ...f, requirements: f.requirements });
  const wantPublish = input.publish !== false;
  let status = !wantPublish ? "draft" : signalsHit.length ? "review" : "published", reviewReason = null;
  if (status === "review") { reviewReason = JSON.stringify({ signals: signalsHit, prev: verification }); verification = "review"; }
  if (source === "official" && wantPublish && L.scamSignals(f).length) { status = "review"; reviewReason = JSON.stringify({ signals: L.scamSignals(f), prev: verification }); }
  const id = uid(), t = nowIso();
  const row = { ...f, company_id: company?.id || null, company_name: companyName, created_by_key: v.key, created_by_anonymous_id: v.key, created_by_display: source === "official" ? "Company representative" : "Community member", source, verification, awaiting_company: awaiting, status, review_reason: reviewReason, published_at: status === "published" ? t : null, created_at: t, updated_at: t };
  row.transparency = L.transparency({ ...row, locations: f.locations }).score;
  const cols = Object.keys(row);
  await contentDb.prepare(`INSERT INTO jobs (id, ${cols.join(", ")}) VALUES (?, ${cols.map(() => "?").join(", ")})`).run(id, ...cols.map((k) => dbVal(k, row[k])));
  await jobLog(id, source === "official" ? "rep" : "member", "created", `${source} · ${status}${reviewReason ? " · held: " + (JSON.parse(reviewReason).signals || []).join("; ") : ""}`);
  if (status === "published") (await import("./alerts.js")).onJobPublished(id).catch(() => {});
  return { id, status, verification, note: status === "review" ? "A moderator will look at this before it goes live (it matched a safety check)." : null };
}

async function jobFor(v, id, { write = true } = {}) {
  const j = await contentDb.prepare("SELECT * FROM jobs WHERE id = ?").get(id); if (!j) throw err("Job not found.", 404, "NOT_FOUND");
  let allowed = false, ctx = null;
  if (j.source === "official" && j.company_id) { try { ctx = await companyCtx(j.company_id, v.key); allowed = ctx.can("jobs.post") || ctx.can("jobs.manage"); } catch { allowed = false; } }
  else allowed = j.created_by_key === v.key;
  if (write && !allowed) throw err("You can't change this job.", 403, "FORBIDDEN");
  return { j, ctx, allowed };
}
export async function updateJob(v, id, input) {
  const { j } = await jobFor(v, id); const f = clean({ ...mapJob(j), workplaceMode: input.workplaceMode ?? j.workplace_mode, ...input });
  if (f.title.length < 3) throw err("Give the job a title.");
  if (j.source !== "official") { f.application_method = "external"; if (!f.external_url) throw err("Add the link where people can apply."); }
  const patch = { ...f, updated_at: nowIso() }; patch.transparency = L.transparency({ ...patch }).score;
  if (j.source !== "official" && L.scamSignals(f).length && j.status === "published") { patch.status = "review"; patch.review_reason = JSON.stringify({ signals: L.scamSignals(f), prev: j.verification }); patch.verification = "review"; }
  const cols = Object.keys(patch);
  await contentDb.prepare(`UPDATE jobs SET ${cols.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...cols.map((k) => dbVal(k, patch[k])), id);
  return { ok: true, status: patch.status || j.status };
}
export async function setJobStatus(v, id, to) {
  const { j, ctx } = await jobFor(v, id);
  if (!L.JOB_STATUSES.includes(to) || !L.canMove(j.status, to)) throw err(`A ${j.status} job can't become ${to}.`);
  if (to === "published") {
    if (j.verification === "review" || j.status === "review") throw err("This job is waiting for a moderator.", 403, "IN_REVIEW");
    if (j.source === "official") { if (!ctx.verified) throw err("Verify your company page first.", 403, "NOT_VERIFIED"); if (await activeCount(j.company_id) >= JOBS_MAX[ctx.plan]) throw err(`Your plan allows ${JOBS_MAX[ctx.plan]} active jobs.`, 403, "PLAN_LIMIT"); }
    if (L.scamSignals(mapJob(j)).length && j.source !== "official") throw err("A moderator needs to review this first.", 403, "IN_REVIEW");
  }
  const t = nowIso(), set = { status: to, updated_at: t }; if (to === "published" && !j.published_at) set.published_at = t; if (to === "filled") set.filled_at = t; if (["closed", "withdrawn", "expired"].includes(to)) set.closed_at = t;
  const cols = Object.keys(set); await contentDb.prepare(`UPDATE jobs SET ${cols.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...cols.map((k) => set[k]), id);
  await jobLog(id, ctx ? `rep:${ctx.handle}` : "member", "status", `${j.status} → ${to}`);
  if (to === "published") (await import("./alerts.js")).onJobPublished(id).catch(() => {});
  if (["filled", "closed"].includes(to)) await notifyApplicantsClosed(j, to);
  return { ok: true };
}
async function notifyApplicantsClosed(j, to) {
  const apps = await contentDb.prepare("SELECT candidate_key FROM job_applications WHERE job_id = ? AND stage IN ('new','screening','interview','final')").all(j.id);
  for (const a of apps) { const acct = await resolveAliasAccountId(a.candidate_key).catch(() => null); if (acct) await createNotification(acct, "job_application", `${j.title} at ${j.company_name} is no longer open (${to === "filled" ? "position filled" : "closed"}).`, null).catch(() => {}); }
}
// A rep claims a community/associated job as their company's own.
export async function claimJob(v, jobId) {
  const j = await contentDb.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId); if (!j) throw err("Job not found.", 404, "NOT_FOUND");
  if (j.source === "official") throw err("This job is already official.");
  const co = j.company_id ? { id: j.company_id } : await contentDb.prepare("SELECT id FROM companies WHERE name_norm = ? AND status = 'active'").get(normCompany(j.company_name));
  if (!co) throw err("No LinkedOut company matches this job.", 404, "NOT_FOUND");
  const ctx = await companyCtx(co.id, v.key, "jobs.post"); if (!ctx.verified) throw err("Verify your company page first.", 403, "NOT_VERIFIED");
  await contentDb.prepare("UPDATE jobs SET company_id = ?, source = 'official', verification = 'verified', awaiting_company = 0, updated_at = ? WHERE id = ?").run(co.id, nowIso(), jobId);
  await jobLog(jobId, `rep:${ctx.handle}`, "claimed", ctx.c.name);
  return { ok: true };
}

// ------------------------------------------------------------------ discovery
const OPEN_SQL = "status = 'published' AND (deadline IS NULL OR deadline > ?)";
export async function searchJobs(f = {}, v = null) {
  const where = [OPEN_SQL], p = [nowIso()];
  const q = clip(f.q, 80); if (q) { where.push("(title ILIKE ? OR company_name ILIKE ? OR skills ILIKE ? OR description ILIKE ? OR department ILIKE ?)"); p.push(...Array(5).fill(`%${q.replace(/[%_]/g, "")}%`)); }
  const loc = clip(f.location, 60); if (loc) { where.push("(locations ILIKE ? OR workplace_mode = 'remote')"); p.push(`%${loc.replace(/[%_]/g, "")}%`); }
  const IN = (col, arr, ok) => { const a = (Array.isArray(arr) ? arr : String(arr || "").split(",")).filter((x) => ok.includes(x)); if (a.length) { where.push(`${col} IN (${a.map(() => "?").join(",")})`); p.push(...a); } };
  IN("workplace_mode", f.modes, L.WORK_MODES); IN("employment_type", f.types, L.EMPLOYMENT_TYPES); IN("seniority", f.seniority, L.SENIORITY);
  if (f.verifiedOnly) where.push("verification = 'verified'");
  const tmin = { good: 65, excellent: 85 }[f.transparency]; if (tmin) { where.push("transparency >= ?"); p.push(tmin); }
  const within = Number(f.postedWithin); if (within > 0) { where.push("published_at > ?"); p.push(new Date(Date.now() - within * DAY).toISOString()); }
  if (Number(f.closesWithin) > 0) { where.push("deadline IS NOT NULL AND deadline < ?"); p.push(new Date(Date.now() + Number(f.closesWithin) * DAY).toISOString()); }
  if (f.visa) where.push("visa_sponsorship = 1"); if (f.relocation) where.push("relocation = 1");
  if (f.companyId) { where.push("company_id = ?"); p.push(f.companyId); } else if (clip(f.company, 80)) { where.push("company_name ILIKE ?"); p.push(`%${clip(f.company, 80).replace(/[%_]/g, "")}%`); }
  for (const s of list(f.skills, 5, 40)) { where.push("skills ILIKE ?"); p.push(`%${s.replace(/[%_]/g, "")}%`); }
  const industry = clip(f.industry, 60);
  let rows = (await contentDb.prepare(`SELECT * FROM jobs WHERE ${where.join(" AND ")} ORDER BY COALESCE(published_at, created_at) DESC LIMIT 700`).all(...p)).map(mapJob);
  const smin = num(f.salaryMin); if (smin) rows = rows.filter((j) => j.salary_max != null && j.salary_max >= smin);
  const cos = await companiesById(rows.map((r) => r.company_id));
  if (industry) rows = rows.filter((j) => cos[j.company_id]?.industry === industry);
  const prefs = v?.key ? await getPrefs(v) : null, beh = v?.key ? await behavior(v.key) : {};
  const sort = ["newest", "transparency", "relevance", "match"].includes(f.sort) ? f.sort : q ? "relevance" : "relevance";
  const withMatch = rows.map((j) => ({ j, rank: L.rankScore(j), m: prefs && Object.keys(prefs).length ? L.matchScore(j, prefs, beh) : { score: null, reasons: [] } }));
  withMatch.sort((a, b) => sort === "newest" ? new Date(b.j.published_at || b.j.created_at) - new Date(a.j.published_at || a.j.created_at) : sort === "transparency" ? b.j.transparency - a.j.transparency : sort === "match" && a.m.score != null ? (b.m.score ?? 0) - (a.m.score ?? 0) : b.rank - a.rank);
  const page = Math.max(1, Number(f.page) || 1), per = 20, slice = withMatch.slice((page - 1) * per, page * per);
  const saved = v?.key ? new Set((await contentDb.prepare("SELECT job_id FROM job_saves WHERE candidate_key = ?").all(v.key)).map((r) => r.job_id)) : new Set();
  const cards = await Promise.all(slice.map(async ({ j, m }, i) => card(j, cos[j.company_id], { match: m.score, matchReasons: m.reasons, saved: saved.has(j.id), reputation: j.company_id && page === 1 && i < 8 ? await repLabel(cos[j.company_id]).catch(() => null) : peekRep(j.company_id) })));
  // Promoted jobs: a separate, labelled slot. They are the same jobs that match this search, shown above the list; they do not change organic rank.
  let promoted = [];
  if (page === 1) { const pids = new Set(await activePromotedIds().catch(() => [])); const hit = withMatch.filter(({ j }) => pids.has(j.id)).sort(() => Math.random() - 0.5).slice(0, 2);
    promoted = hit.map(({ j, m }) => card(j, cos[j.company_id], { promoted: true, match: m.score, matchReasons: m.reasons, saved: saved.has(j.id), reputation: peekRep(j.company_id) })); if (promoted.length) countImpressions(promoted.map((x) => x.id)).catch(() => {}); }
  return { jobs: cards.filter((c) => !promoted.some((p2) => p2.id === c.id)), promoted, total: withMatch.length, page, pages: Math.ceil(withMatch.length / per), personalised: !!(prefs && Object.keys(prefs).length) };
}
const repCache = new Map();
const peekRep = (id) => repCache.get(id)?.v ?? null;
async function repLabel(co) {
  if (!co) return null; const hit = repCache.get(co.id); if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.v;
  const c = await contentDb.prepare("SELECT id, name, industry, owner_key, verification, status FROM companies WHERE id = ?").get(co.id); const ps = await publicSignals(c);
  const v = { health: ps.health?.label || null, response: ps.response?.label || null }; repCache.set(co.id, { at: Date.now(), v }); if (repCache.size > 400) repCache.clear(); return v;
}
export async function homepage(v) {
  const [recent, rec, facets] = await Promise.all([searchJobs({ sort: "newest" }, v), recommended(v), contentDb.prepare(`SELECT workplace_mode m, COUNT(*) n FROM jobs WHERE ${OPEN_SQL} GROUP BY workplace_mode`).all(nowIso())]);
  return { recommended: rec, newest: recent.jobs.slice(0, 8), total: recent.total, modes: facets };
}
export async function recommended(v) {
  const prefs = v?.key ? await getPrefs(v) : null; const hasPrefs = prefs && Object.keys(prefs).length;
  const r = await searchJobs({ sort: hasPrefs ? "match" : "transparency" }, v);
  return { personalised: !!hasPrefs, jobs: r.jobs.slice(0, 8) };
}
async function behavior(key) {
  const a = await contentDb.prepare("SELECT company_id FROM job_applications WHERE candidate_key = ? LIMIT 50").all(key);
  const s = await contentDb.prepare("SELECT j.company_id FROM job_saves s JOIN jobs j ON j.id = s.job_id WHERE s.candidate_key = ? LIMIT 50").all(key);
  const i = await contentDb.prepare("SELECT j.company_id FROM job_interest s JOIN jobs j ON j.id = s.job_id WHERE s.candidate_key = ? LIMIT 50").all(key);
  return { companyIds: [...new Set([...a, ...s, ...i].map((x) => x.company_id).filter(Boolean))] };
}
export async function getPrefs(v) { const r = await contentDb.prepare("SELECT data FROM job_preferences WHERE candidate_key = ?").get(v.key); return J(r?.data, {}); }
export async function setPrefs(v, d) {
  const data = { titles: list(d.titles, 6, 60), skills: list(d.skills, 20, 40), locations: list(d.locations, 5, 60), modes: (Array.isArray(d.modes) ? d.modes : []).filter((m) => L.WORK_MODES.includes(m)), salaryMin: num(d.salaryMin), seniority: L.SENIORITY.includes(d.seniority) ? d.seniority : null };
  await contentDb.prepare(`INSERT INTO job_preferences (candidate_key, data, updated_at) VALUES (?,?,?) ON CONFLICT (candidate_key) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`).run(v.key, JSON.stringify(data), nowIso()); return data;
}

// ------------------------------------------------------------------ the job page + "Before you apply"
export async function getJob(id, v = null, { count = true } = {}) {
  const raw = await contentDb.prepare("SELECT * FROM jobs WHERE id = ?").get(id); if (!raw) throw err("Job not found.", 404, "NOT_FOUND");
  const j = mapJob(raw), isOwner = v?.key && (j.created_by_key === v.key);
  const visible = ["published", "paused", "filled", "expired", "closed"].includes(j.status) && j.verification !== "review";
  let isRep = false; if (j.company_id && v?.key) { try { const c = await companyCtx(j.company_id, v.key); isRep = c.can("jobs.post") || c.can("applicants.view"); } catch { /* not a rep */ } }
  if (!visible && !isOwner && !isRep) throw err("Job not found.", 404, "NOT_FOUND");
  if (count && visible) { await contentDb.prepare("UPDATE jobs SET views = views + 1 WHERE id = ?").run(id); await contentDb.prepare("INSERT INTO job_views (job_id, day, n) VALUES (?,?,1) ON CONFLICT (job_id, day) DO UPDATE SET n = job_views.n + 1").run(id, nowIso().slice(0, 10)).catch(() => {}); }
  const co = j.company_id ? (await companiesById([j.company_id]))[j.company_id] : null;
  const t = L.transparency(j), interested = Number((await contentDb.prepare("SELECT COUNT(*) n FROM job_interest WHERE job_id = ?").get(id)).n);
  const mine = v?.key ? { saved: !!(await contentDb.prepare("SELECT 1 x FROM job_saves WHERE candidate_key = ? AND job_id = ?").get(v.key, id)), interested: !!(await contentDb.prepare("SELECT 1 x FROM job_interest WHERE candidate_key = ? AND job_id = ?").get(v.key, id)), application: await contentDb.prepare("SELECT id, stage FROM job_applications WHERE candidate_key = ? AND job_id = ?").get(v.key, id) } : null;
  return { ...card(j, co), description: j.description, responsibilities: j.responsibilities, requirements: j.requirements, preferred: j.preferred, benefits: j.benefits, skills: j.skills, hiringProcess: j.hiring_process, screeningQuestions: j.screening_questions,
    officeDays: j.office_days, bonusEquity: j.bonus_equity, salaryMin: j.salary_min, salaryMax: j.salary_max, currency: j.currency, salaryPeriod: j.salary_period, visa: !!j.visa_sponsorship, relocation: !!j.relocation, externalUrl: j.application_method === "external" ? j.external_url : null, roleContext: j.role_context,
    transparencyItems: t.items, interested: interested >= M.MIN_COHORT ? interested : null, views: undefined, mine, company2: co ? { id: co.id, name: co.name, industry: co.industry } : null,
    canEdit: !!(isOwner || isRep), reviewNote: j.status === "review" ? "Waiting for a moderator." : null };
}
export async function jobIntel(id) {
  const j = mapJob(await contentDb.prepare("SELECT * FROM jobs WHERE id = ?").get(id) || (() => { throw err("Job not found.", 404, "NOT_FOUND"); })());
  if (!j.company_id) return { available: false, note: "This is a community opportunity that isn't linked to a LinkedOut company, so there are no workplace reports to show. Treat it carefully and use the report button if anything looks wrong." };
  const c = await contentDb.prepare("SELECT id, name, industry, owner_key, verification, status FROM companies WHERE id = ? AND status = 'active'").get(j.company_id); if (!c) return { available: false, note: "Company not found." };
  const s = await signals(c), ps = await publicSignals(c), now = Date.now();
  const yr = M.within(s.rows, now - 365 * DAY, now), n = yr.length, d90 = M.within(yr, now - 90 * DAY, now);
  const pos = yr.filter((r) => M.isPositive(r) && !M.isNegative(r)).length, neg = yr.filter((r) => M.isNegative(r) && !M.isPositive(r)).length, mixed = n - pos - neg;
  const pc = (x) => (n ? Math.round((x / n) * 100) : 0);
  const dims = (rows) => L.ROLE_DIMENSIONS.map((d) => { const total = M.distinct(rows); const hit = M.distinct(rows.filter((r) => r._t.some((t) => d.themes.includes(t)))); return total >= M.MIN_COHORT ? { key: d.key, label: d.label, concern: Math.round((hit / total) * 100), level: L.concernLevel(hit / total), n: total } : { key: d.key, label: d.label, level: null, n: total }; });
  const titleHits = yr.filter((r) => L.titleOverlap(j.title, r.role_title) >= 0.5 || (j.department && L.titleOverlap(j.department, r.department) >= 0.67));
  const roleN = M.distinct(titleHits);
  const rto = M.distinct(yr.filter((r) => r._t.includes("rto")));
  const hiring = s.health.hiring, survey = await surveyStats(c.id);
  let hiringVsIndustry = null; try { const b = await benchmarkFor(c); const m = b.ready && b.metrics.find((x) => x.key === "hiring"); if (m?.available) hiringVsIndustry = m.you > m.median ? "Above industry average" : m.you < m.median ? "Below industry average" : "In line with the industry"; } catch { /* optional */ }
  const claim = j.workplace_mode && ["remote", "hybrid"].includes(j.workplace_mode) && rto >= M.MIN_COHORT && n >= 10 && rto / n >= 0.15
    ? { says: j.workplace_mode === "remote" ? "Remote work" : `Hybrid${j.office_days != null ? `, ${j.office_days} office days` : ""}`, reports: `${rto} of ${n} reports in the last 12 months mention pressure to be in the office.`, note: "Potential mismatch. Reports are one person's experience each, not proof." } : null;
  return { available: true, company: { id: c.id, name: c.name }, reputation: ps.health?.label || null, response: ps.response, badges: ps.badges,
    workplace: n >= M.MIN_COHORT ? { reports: n, positive: pc(pos), mixed: pc(mixed), negative: pc(neg), dimensions: dims(yr), note: `Based on ${n} reports from the last 12 months. A summary of what people shared, not a verdict on the company.` } : { reports: n, note: "Not enough reports yet to show a pattern (at least 5 needed)." },
    role: roleN >= M.MIN_COHORT ? { scope: "role", n: roleN, dimensions: dims(titleHits), note: `${roleN} reports from people in similar roles.` } : { scope: "company", n: roleN, dimensions: n >= M.MIN_COHORT ? dims(yr) : [], note: "Not enough reports about this specific role (at least 5 needed), so this shows the whole company." },
    signals: { stories90: M.distinct(d90), layoffs: M.distinct(d90.filter((r) => r._t.includes("layoffs"))), salary: M.distinct(d90.filter((r) => r._t.includes("salary_change"))), ghosting: M.distinct(d90.filter((r) => r._t.includes("ghosting") || r.format === "ghosted")) },
    hiring: { reports: hiring?.ready ? hiring.stories : 0, vsIndustry: hiringVsIndustry, survey },
    claim, companyContext: j.role_context || null, transparency: j.transparency, companyLink: `/companies/${c.id}` };
}

// ------------------------------------------------------------------ candidate actions
export async function toggleSave(v, id, remind = false) {
  const had = await contentDb.prepare("SELECT 1 x FROM job_saves WHERE candidate_key = ? AND job_id = ?").get(v.key, id);
  if (had && !remind) { await contentDb.prepare("DELETE FROM job_saves WHERE candidate_key = ? AND job_id = ?").run(v.key, id); return { saved: false }; }
  if (had) { await contentDb.prepare("UPDATE job_saves SET remind = 1 WHERE candidate_key = ? AND job_id = ?").run(v.key, id); return { saved: true, remind: true }; }
  await contentDb.prepare("INSERT INTO job_saves (candidate_key, job_id, remind, created_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING").run(v.key, id, remind ? 1 : 0, nowIso()); return { saved: true, remind };
}
export async function savedJobs(v) {
  const rows = (await contentDb.prepare("SELECT j.*, s.remind FROM job_saves s JOIN jobs j ON j.id = s.job_id WHERE s.candidate_key = ? ORDER BY s.created_at DESC LIMIT 100").all(v.key)).map((r) => ({ ...mapJob(r), remind: !!r.remind }));
  const cos = await companiesById(rows.map((r) => r.company_id)); return rows.map((j) => card(j, cos[j.company_id], { saved: true, remind: j.remind }));
}
export async function toggleInterest(v, id) {
  const j = await contentDb.prepare("SELECT id FROM jobs WHERE id = ? AND status = 'published'").get(id); if (!j) throw err("Job not found.", 404, "NOT_FOUND");
  const had = await contentDb.prepare("SELECT 1 x FROM job_interest WHERE job_id = ? AND candidate_key = ?").get(id, v.key);
  if (had) await contentDb.prepare("DELETE FROM job_interest WHERE job_id = ? AND candidate_key = ?").run(id, v.key); else await contentDb.prepare("INSERT INTO job_interest (job_id, candidate_key, created_at) VALUES (?,?,?) ON CONFLICT DO NOTHING").run(id, v.key, nowIso());
  return { interested: !had };
}
export async function reportJob(v, id, { reason, details }) {
  if (!L.REPORT_REASONS[reason]) throw err("Pick a reason.");
  const j = await contentDb.prepare("SELECT id, status FROM jobs WHERE id = ?").get(id); if (!j) throw err("Job not found.", 404, "NOT_FOUND");
  const dup = await contentDb.prepare("SELECT 1 x FROM content_reports WHERE target_type = 'job' AND target_id = ? AND reporter_key = ? AND status = 'open'").get(id, v.key); if (dup) throw err("You've already reported this job.", 400, "DUPLICATE");
  await contentDb.prepare("INSERT INTO content_reports (id, target_type, target_id, reporter_key, reason, details, created_at) VALUES (?,?,?,?,?,?,?)").run(uid(), "job", id, v.key, `${L.REPORT_REASONS[reason]}`, redactFields({ d: clip(details, 600) }).values.d || null, nowIso());
  // Three different people reporting a serious problem takes the job out of search until a moderator looks.
  const serious = ["Scam", "Fake company", "Impersonation", "Recruitment fee"];
  const n = Number((await contentDb.prepare("SELECT COUNT(DISTINCT reporter_key) n FROM content_reports WHERE target_type = 'job' AND target_id = ? AND status = 'open' AND reason IN (?,?,?,?)").get(id, ...serious)).n);
  if (n >= 3 && j.status === "published") await jobLog(id, "system", "auto-held", "3 serious reports");
  if (n >= 3 && j.status === "published") await contentDb.prepare("UPDATE jobs SET status = 'review', verification = 'review', review_reason = ? WHERE id = ?").run(JSON.stringify({ signals: ["reported by 3 people"], prev: "community" }), id);
  return { ok: true };
}

// ------------------------------------------------------------------ applying
export function snapshotOf(account, { shareName = true, email = "", phone = "", headline = "" } = {}) {
  return { name: shareName ? account.real_name : account.pseudonym || "LinkedOut member", headline: clip(headline, 140) || clip(account.bio, 140), country: account.country || null,
    identityVerified: ["verified", "approved"].includes(account.government_id_status), email: clip(email, 120) || null, phone: clip(phone, 40) || null };
}
export async function apply(v, jobId, input) {
  const j = mapJob(await contentDb.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) || (() => { throw err("Job not found.", 404, "NOT_FOUND"); })());
  if (!L.acceptingApplications(j)) throw err("This job isn't accepting applications.", 400, "CLOSED");
  if (j.source !== "official" || j.application_method !== "internal" || !j.company_id) throw err("Apply on the link the poster gave.", 400, "EXTERNAL");
  if (await contentDb.prepare("SELECT 1 x FROM job_applications WHERE job_id = ? AND candidate_key = ?").get(jobId, v.key)) throw err("You've already applied.", 400, "DUPLICATE");
  const day = Number((await contentDb.prepare("SELECT COUNT(*) n FROM job_applications WHERE candidate_key = ? AND created_at > ?").get(v.key, new Date(Date.now() - DAY).toISOString())).n); if (day >= 25) throw err("That's 25 applications today. Pace yourself.", 429, "RATE_LIMITED");
  const resume = clip(input.resumeText, 20000), links = list(input.links, 5, 300).filter((l) => /^https:\/\//.test(l));
  if (resume.length < 50 && !links.length) throw err("Add your resume (paste the text) or a link to your work.");
  const answers = j.screening_questions.map((q, i) => ({ q, a: clip(input.answers?.[i], 1000) })); if (answers.some((a) => !a.a)) throw err("Answer each screening question.");
  const id = uid(), t = nowIso(), snap = snapshotOf(v.account, input);
  await contentDb.prepare(`INSERT INTO job_applications (id, job_id, company_id, candidate_key, snapshot, resume_text, cover_letter, links, answers, stage, stage_history, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,'new',?,?,?)`).run(id, jobId, j.company_id, v.key, JSON.stringify(snap), resume || null, clip(input.coverLetter, 4000) || null, JSON.stringify(links), JSON.stringify(answers), JSON.stringify([{ stage: "new", at: t }]), t, t);
  const msg = `New application for ${j.title}. Open your Command Center's Jobs tab.`;
  await notifyRoles(j.company_id, ["owner", "admin", "recruiter"], msg).catch(() => {}); await deliverWebhooks(j.company_id, "application", { text: msg, data: { jobId, applicationId: id } }).catch(() => {});
  return { id, stage: "new" };
}
export async function myApplications(v) {
  const rows = await contentDb.prepare("SELECT a.*, j.title, j.company_name, j.status jstatus, j.deadline FROM job_applications a JOIN jobs j ON j.id = a.job_id WHERE a.candidate_key = ? ORDER BY a.updated_at DESC LIMIT 100").all(v.key);
  const ids = rows.map((r) => r.id); const unread = ids.length ? await contentDb.prepare("SELECT application_id, COUNT(*) n FROM job_messages WHERE application_id = ANY(?) AND sender = 'company' AND read_by_candidate = 0 GROUP BY application_id").all(ids) : [];
  const iv = ids.length ? await contentDb.prepare("SELECT application_id, id, slots, chosen, status FROM job_interviews WHERE application_id = ANY(?) AND status IN ('proposed','confirmed','reschedule_requested') ORDER BY created_at DESC").all(ids) : [];
  const cos = await companiesById(rows.map((r) => r.company_id));
  return rows.map((a) => ({ id: a.id, jobId: a.job_id, title: a.title, company: cos[a.company_id]?.name || a.company_name, companyId: a.company_id, stage: a.stage, stageLabel: L.STAGE_LABEL[a.stage],
    history: J(a.stage_history, []).map((h) => ({ stage: h.stage, label: L.STAGE_LABEL[h.stage], at: h.at })), applied: formatRelativeTime(a.created_at), jobOpen: a.jstatus === "published",
    unread: Number(unread.find((u) => u.application_id === a.id)?.n || 0), interview: (() => { const i = iv.find((x) => x.application_id === a.id); return i ? { id: i.id, slots: J(i.slots, []), chosen: i.chosen, status: i.status } : null; })(),
    survey: ["hired", "rejected", "withdrawn"].includes(a.stage) && !a.survey_done || (!a.survey_done && Date.now() - new Date(a.created_at).getTime() > 21 * DAY) }));
}
export async function withdraw(v, applicationId) {
  const a = await contentDb.prepare("SELECT * FROM job_applications WHERE id = ? AND candidate_key = ?").get(applicationId, v.key); if (!a) throw err("Not found.", 404, "NOT_FOUND");
  if (["hired", "rejected", "withdrawn"].includes(a.stage)) throw err("This application is already closed."); await setStage(a, "withdrawn", null); return { ok: true };
}
export async function setStage(a, stage, notifyText) {
  const hist = J(a.stage_history, []); hist.push({ stage, at: nowIso() });
  await contentDb.prepare("UPDATE job_applications SET stage = ?, stage_history = ?, updated_at = ? WHERE id = ?").run(stage, JSON.stringify(hist), nowIso(), a.id);
  await addMessage({ applicationId: a.id, companyId: a.company_id, candidateKey: a.candidate_key, sender: "system", kind: "event", text: `Application moved to: ${L.STAGE_LABEL[stage]}` }).catch(() => {});
  if (notifyText) { const acct = await resolveAliasAccountId(a.candidate_key).catch(() => null); if (acct) await createNotification(acct, "job_application", notifyText, null).catch(() => {}); }
}

// ---- application messages (encrypted at rest; company side is a team, candidate side is one person)
// A message body is an envelope {t: text, l: [https links], i: interviewId}. Kinds: text | event (system timeline) | interview (card) | request (document request).
const CO = (companyId) => `co:${companyId}`;
const pack = (o) => JSON.stringify(o);
const unpack = (raw) => { try { const o = JSON.parse(raw); if (o && typeof o === "object" && "t" in o) return o; } catch { /* legacy plain text */ } return { t: raw }; };
export async function addMessage({ applicationId, companyId, candidateKey, sender, handle = null, kind = "text", text, links = [], interviewId = null }) {
  const key = sender === "candidate" ? candidateKey : CO(companyId);
  const body = encryptMessage(applicationId, key, pack({ t: clip(text, 3000), l: links.filter((x) => /^https:\/\/[^\s]+$/.test(x)).slice(0, 4), i: interviewId }));
  const id = uid(); await contentDb.prepare("INSERT INTO job_messages (id, application_id, sender, sender_handle, body, kind, read_by_candidate, read_by_company, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, applicationId, sender, handle, body, kind, sender === "candidate" ? 1 : 0, sender === "company" ? 1 : 0, nowIso()); return id;
}
export async function threadFor(applicationId, side, viewerKey, since = null) {
  const a = await contentDb.prepare("SELECT company_id, candidate_key FROM job_applications WHERE id = ?").get(applicationId);
  const msgs = await contentDb.prepare(`SELECT * FROM job_messages WHERE application_id = ? ${since ? "AND created_at > ?" : ""} ORDER BY created_at LIMIT 300`).all(...(since ? [applicationId, since] : [applicationId]));
  await contentDb.prepare(`UPDATE job_messages SET ${side === "candidate" ? "read_by_candidate" : "read_by_company"} = 1 WHERE application_id = ? AND sender <> ? AND sender <> 'system'`).run(applicationId, side);
  const iv = await contentDb.prepare("SELECT id, slots, chosen, status, mode, link, duration_min FROM job_interviews WHERE application_id = ?").all(applicationId);
  return msgs.map((m) => {
    const key = m.sender === "candidate" ? a.candidate_key : CO(a.company_id), o = unpack(decryptMessage(applicationId, key, m.body)), i = o.i ? iv.find((x) => x.id === o.i) : null;
    return { id: m.id, from: m.sender, who: m.sender === "company" ? (m.sender_handle || "Company") : m.sender === "candidate" ? "Candidate" : "LinkedOut", kind: m.kind, body: o.t, links: o.l || [], at: m.created_at, ago: formatRelativeTime(m.created_at), mine: m.sender === side,
      seen: m.sender === side ? !!(side === "candidate" ? m.read_by_company : m.read_by_candidate) : null,
      interview: i ? { id: i.id, slots: J(i.slots, []), chosen: i.chosen, status: i.status, mode: i.mode, link: i.link, duration: i.duration_min } : null };
  });
}
export async function candidateMessage(v, applicationId, text, links = []) {
  const a = await contentDb.prepare("SELECT * FROM job_applications WHERE id = ? AND candidate_key = ?").get(applicationId, v.key); if (!a) throw err("Not found.", 404, "NOT_FOUND");
  const body = clip(text, 3000); if (body.length < 1) throw err("Write a message.");
  const n = Number((await contentDb.prepare("SELECT COUNT(*) n FROM job_messages WHERE application_id = ? AND sender = 'candidate' AND created_at > ?").get(applicationId, new Date(Date.now() - DAY).toISOString())).n); if (n >= 30) throw err("That's a lot of messages today.", 429, "RATE_LIMITED");
  await addMessage({ applicationId, companyId: a.company_id, candidateKey: a.candidate_key, sender: "candidate", text: body, links });
  await notifyRoles(a.company_id, ["owner", "admin", "recruiter"], "A candidate replied to your message about an application.").catch(() => {}); return { ok: true };
}
export async function respondInterview(v, { interviewId, action, slot }) {
  const i = await contentDb.prepare("SELECT i.*, a.candidate_key, a.company_id cid FROM job_interviews i JOIN job_applications a ON a.id = i.application_id WHERE i.id = ?").get(interviewId); if (!i || i.candidate_key !== v.key) throw err("Not found.", 404, "NOT_FOUND");
  const ev = (t) => contentDb.prepare("SELECT application_id FROM job_interviews WHERE id = ?").get(interviewId).then((r) => addMessage({ applicationId: r.application_id, companyId: i.cid, candidateKey: i.candidate_key, sender: "system", kind: "event", text: t })).catch(() => {});
  if (action === "choose") { if (!J(i.slots, []).includes(slot)) throw err("Pick one of the offered times."); await contentDb.prepare("UPDATE job_interviews SET chosen = ?, status = 'confirmed' WHERE id = ?").run(slot, interviewId); await ev(`Interview confirmed for ${new Date(slot).toUTCString()}.`); await notifyRoles(i.cid, ["owner", "admin", "recruiter"], "A candidate confirmed an interview time.").catch(() => {}); }
  else if (action === "reschedule") { await contentDb.prepare("UPDATE job_interviews SET status = 'reschedule_requested', chosen = NULL WHERE id = ?").run(interviewId); await ev("The candidate asked to reschedule."); await notifyRoles(i.cid, ["owner", "admin", "recruiter"], "A candidate asked to reschedule an interview.").catch(() => {}); }
  else if (action === "decline") { await contentDb.prepare("UPDATE job_interviews SET status = 'cancelled' WHERE id = ?").run(interviewId); }
  else throw err("Unknown action.");
  return { ok: true };
}

// ------------------------------------------------------------------ hiring-experience survey (anonymous, aggregate)
export const SURVEY_QUESTIONS = [
  { key: "communicated", q: "Did the company communicate clearly?", type: "yesno" }, { key: "speed", q: "How long did they take to get back to you?", type: "choice", options: ["Under a week", "1-2 weeks", "2-4 weeks", "Over 4 weeks", "Never did"] },
  { key: "expectations", q: "Were expectations accurate?", type: "yesno" }, { key: "salary", q: "Was salary discussed transparently?", type: "yesno" }, { key: "respectful", q: "Were interviews respectful?", type: "yesno" },
  { key: "matched", q: "Did the advertised role match reality?", type: "yesno" }, { key: "ghosted", q: "Did they ghost you?", type: "yesno" },
];
export async function submitSurvey(v, applicationId, answers) {
  const a = await contentDb.prepare("SELECT * FROM job_applications WHERE id = ? AND candidate_key = ?").get(applicationId, v.key); if (!a) throw err("Not found.", 404, "NOT_FOUND");
  if (a.survey_done) throw err("You've already answered this.", 400, "DUPLICATE");
  const clean2 = {}; for (const q of SURVEY_QUESTIONS) { const x = answers?.[q.key]; if (q.type === "yesno") clean2[q.key] = x === true || x === "yes" ? 1 : x === false || x === "no" ? 0 : null; else clean2[q.key] = q.options.includes(x) ? x : null; }
  if (Object.values(clean2).every((x) => x == null)) throw err("Answer at least one question.");
  // Flag first, then store the anonymous answers: the stored row has no application id and only the month.
  await contentDb.prepare("UPDATE job_applications SET survey_done = 1 WHERE id = ?").run(applicationId);
  await contentDb.prepare("INSERT INTO hiring_surveys (id, company_id, month, answers) VALUES (?,?,?,?)").run(uid(), a.company_id, nowIso().slice(0, 7), JSON.stringify(clean2)); return { ok: true };
}
