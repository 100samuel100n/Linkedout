// Company-side hiring: jobs dashboard, applicant pipeline, notes, messages, interviews, history, AI review.
// Every function takes a ctx from companyCtx() and checks the role permission and that the job belongs to THIS company.
import crypto from "node:crypto";
import { contentDb, formatRelativeTime } from "../content/db.js";
import { StoryError } from "../stories/service.js";
import { auditCompany } from "../stories/business.js";
import { has, JOBS_MAX, levelOf, advanced } from "../business-features.js";
import { callModel, isAiConfigured } from "../ai.js";
import { createNotification, resolveAliasAccountId } from "../identity/service.js";
import { encryptMessage } from "../messaging/crypto.js";
import { mapJob, setStage, threadFor, addMessage, SOURCE_LABEL, VERIFICATION_LABEL } from "./service.js";
import { surveyStats } from "./surveys.js";
import { teamAllows } from "./enterprise.js";
import * as L from "./logic.js";

const nowIso = () => new Date().toISOString(), uid = () => crypto.randomUUID(), DAY = 864e5;
const clip = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const J = (v, f) => { try { return JSON.parse(v) ?? f; } catch { return f; } };
const err = (m, s = 400, c = "BAD_REQUEST") => new StoryError(m, s, c);
const need = (ctx, perm) => { if (!ctx.can(perm)) throw err("Your role on this company can't do that.", 403, "ROLE_FORBIDDEN"); };
const FREE_STAGES = ["new", "rejected", "hired"];

async function ownJob(ctx, jobId, { applicants = false } = {}) { const j = await contentDb.prepare("SELECT * FROM jobs WHERE id = ? AND company_id = ?").get(jobId, ctx.c.id); if (!j) throw err("Job not found.", 404, "NOT_FOUND"); if (applicants && !teamAllows(ctx, j)) throw err("This job's applicants are limited to its hiring team.", 403, "TEAM_ONLY"); return mapJob(j); }
async function ownApp(ctx, id) { const a = await contentDb.prepare("SELECT * FROM job_applications WHERE id = ? AND company_id = ?").get(id, ctx.c.id); if (!a) throw err("Application not found.", 404, "NOT_FOUND"); const j = await contentDb.prepare("SELECT team FROM jobs WHERE id = ?").get(a.job_id); if (j && !teamAllows(ctx, j)) throw err("This job's applicants are limited to its hiring team.", 403, "TEAM_ONLY"); return a; }

export async function jobsOverview(ctx) {
  if (!ctx.can("jobs.post") && !ctx.can("applicants.view") && !ctx.can("hiring.insights")) throw err("Your role can't see hiring.", 403, "ROLE_FORBIDDEN");
  const jobs = (await contentDb.prepare("SELECT * FROM jobs WHERE company_id = ? ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 200").all(ctx.c.id)).map(mapJob), ids = jobs.map((j) => j.id);
  const seeApps = ctx.can("applicants.view");
  const apps = seeApps && ids.length ? await contentDb.prepare("SELECT job_id, stage, COUNT(*) n FROM job_applications WHERE company_id = ? GROUP BY job_id, stage").all(ctx.c.id) : [];
  const since = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
  const views = ids.length ? await contentDb.prepare("SELECT job_id, SUM(n) n FROM job_views WHERE job_id = ANY(?) AND day > ? GROUP BY job_id").all(ids, since) : [];
  const interest = ids.length ? await contentDb.prepare("SELECT job_id, COUNT(*) n FROM job_interest WHERE job_id = ANY(?) GROUP BY job_id").all(ids) : [];
  const by = (id) => Object.fromEntries(apps.filter((a) => a.job_id === id).map((a) => [a.stage, Number(a.n)]));
  const rows = jobs.map((j) => { const st = by(j.id), total = Object.values(st).reduce((a, b) => a + b, 0), reached = (k) => (L.STAGES.slice(L.STAGES.indexOf(k)).filter((s) => !["rejected", "withdrawn"].includes(s)).reduce((a, s) => a + (st[s] || 0), 0));
    return { id: j.id, title: j.title, status: j.status, source: j.source, sourceLabel: SOURCE_LABEL[j.source], verification: j.verification, verificationLabel: VERIFICATION_LABEL[j.verification], transparency: j.transparency, deadline: j.deadline, mode: j.workplace_mode, awaiting: !!j.awaiting_company,
      views30: Number(views.find((v) => v.job_id === j.id)?.n || 0), interested: Number(interest.find((v) => v.job_id === j.id)?.n || 0), pipeline: seeApps ? st : null,
      funnel: seeApps && has(ctx.plan, "candidate_analytics") ? { applications: total, qualified: reached("screening"), interviews: reached("interview"), offers: reached("offer"), hired: st.hired || 0 } : null, internalApply: j.application_method === "internal", team: J(j.team, []), age: formatRelativeTime(j.published_at || j.created_at) }; });
  const act = rows.filter((r) => ["published", "paused"].includes(r.status));
  const tot = (k) => rows.reduce((a, r) => a + (r.pipeline?.[k] || 0), 0);
  return { jobs: rows, limit: JOBS_MAX[ctx.plan], active: act.length, totals: seeApps ? { applications: rows.reduce((a, r) => a + Object.values(r.pipeline || {}).reduce((x, y) => x + y, 0), 0), interviews: tot("interview"), offers: tot("offer"), hires: tot("hired") } : null,
    canPost: ctx.can("jobs.post") && ctx.verified, promoCap: Number(levelOf(ctx.plan, "promoted_jobs")) || 0, teams: has(ctx.plan, "hiring_teams"), notVerified: !ctx.verified, pipelineFull: has(ctx.plan, "applicant_pipeline"), claimable: await claimable(ctx) };
}
export async function claimable(ctx) {
  if (!ctx.can("jobs.post")) return [];
  return (await contentDb.prepare("SELECT id, title, created_at, verification FROM jobs WHERE source <> 'official' AND status IN ('published','review') AND (company_id = ? OR (company_id IS NULL AND company_name ILIKE ?)) LIMIT 30").all(ctx.c.id, ctx.c.name.replace(/[%_]/g, "")))
    .map((j) => ({ id: j.id, title: j.title, ago: formatRelativeTime(j.created_at) }));
}
export async function jobForEdit(ctx, jobId) { need(ctx, "jobs.post"); const j = await ownJob(ctx, jobId); const t = L.transparency(j); return { job: j, transparency: t }; }

export async function applicants(ctx, jobId, stage) {
  need(ctx, "applicants.view"); const j = await ownJob(ctx, jobId, { applicants: true });
  const rows = await contentDb.prepare("SELECT id, snapshot, stage, rating, created_at, updated_at FROM job_applications WHERE job_id = ? AND company_id = ? ORDER BY created_at DESC LIMIT 400").all(jobId, ctx.c.id);
  const counts = Object.fromEntries(L.STAGES.map((s) => [s, rows.filter((r) => r.stage === s).length]));
  const unread = rows.length ? await contentDb.prepare("SELECT application_id, COUNT(*) n FROM job_messages WHERE application_id = ANY(?) AND sender = 'candidate' AND read_by_company = 0 GROUP BY application_id").all(rows.map((r) => r.id)) : [];
  return { job: { id: j.id, title: j.title, status: j.status }, counts, stages: L.STAGES.map((s) => ({ key: s, label: L.STAGE_LABEL[s] })), pipelineFull: has(ctx.plan, "applicant_pipeline"),
    applicants: rows.filter((r) => !stage || r.stage === stage).map((r) => { const s = J(r.snapshot, {}); return { id: r.id, name: s.name, headline: s.headline, identityVerified: !!s.identityVerified, stage: r.stage, stageLabel: L.STAGE_LABEL[r.stage], rating: r.rating, applied: formatRelativeTime(r.created_at), unread: Number(unread.find((u) => u.application_id === r.id)?.n || 0) }; }) };
}
export async function applicantDetail(ctx, id) {
  need(ctx, "applicants.view"); const a = await ownApp(ctx, id), j = await ownJob(ctx, a.job_id);
  const [notes, ivs] = await Promise.all([has(ctx.plan, "applicant_pipeline") ? contentDb.prepare("SELECT id, author_handle, body, created_at FROM job_application_notes WHERE application_id = ? ORDER BY created_at").all(id) : [], contentDb.prepare("SELECT id, slots, chosen, status, mode, link, notes, duration_min FROM job_interviews WHERE application_id = ? ORDER BY created_at DESC").all(id)]);
  const messages = has(ctx.plan, "applicant_pipeline") && ctx.can("applicants.message") ? await threadFor(id, "company") : [];
  const templates = has(ctx.plan, "applicant_pipeline") && ctx.can("applicants.message") ? await listMsgTemplates(ctx) : [];
  return { id, job: { id: j.id, title: j.title }, snapshot: J(a.snapshot, {}), resume: a.resume_text, coverLetter: a.cover_letter, links: J(a.links, []), answers: J(a.answers, []), stage: a.stage, stageLabel: L.STAGE_LABEL[a.stage], rating: a.rating,
    templates, history: J(a.stage_history, []).map((h) => ({ ...h, label: L.STAGE_LABEL[h.stage] })), notes: notes.map((n) => ({ id: n.id, by: n.author_handle, body: n.body, ago: formatRelativeTime(n.created_at) })), messages,
    interviews: ivs.map((i) => ({ id: i.id, slots: J(i.slots, []), chosen: i.chosen, status: i.status, mode: i.mode, link: i.link, notes: i.notes, duration: i.duration_min })), pipelineFull: has(ctx.plan, "applicant_pipeline") };
}
export async function moveStage(ctx, { applicationId, stage }) {
  need(ctx, "applicants.manage"); if (!L.STAGES.includes(stage)) throw err("Pick a stage.");
  if (!has(ctx.plan, "applicant_pipeline") && !FREE_STAGES.includes(stage)) throw err("Screening, interview, final and offer stages are part of Business.", 403, "PLAN_REQUIRED");
  const a = await ownApp(ctx, applicationId), j = await ownJob(ctx, a.job_id); if (a.stage === stage) return { ok: true };
  if (["hired", "withdrawn"].includes(a.stage)) throw err("This application is closed.");
  await setStage(a, stage, { screening: `Your application for ${j.title} at ${ctx.c.name} moved to screening.`, interview: `You're moving to interviews for ${j.title} at ${ctx.c.name}.`, final: `You're in the final decision stage for ${j.title} at ${ctx.c.name}.`, offer: `${ctx.c.name} has an update on your application for ${j.title}. Open My applications.`, hired: `Congratulations: ${ctx.c.name} marked your ${j.title} application as hired.`, rejected: `${ctx.c.name} has made a decision on your ${j.title} application. Open My applications.` }[stage] || null);
  await auditCompany(ctx.c.id, ctx.handle, "applicant_stage", `${stage}`); return { ok: true };
}
export async function rateApplicant(ctx, { applicationId, rating }) { need(ctx, "applicants.manage"); await ownApp(ctx, applicationId); const r = Math.round(Number(rating)); await contentDb.prepare("UPDATE job_applications SET rating = ? WHERE id = ?").run(r >= 1 && r <= 5 ? r : null, applicationId); return { ok: true }; }
export async function noteApplicant(ctx, { applicationId, body }) {
  need(ctx, "applicants.manage"); if (!has(ctx.plan, "applicant_pipeline")) throw err("Applicant notes are part of Business.", 403, "PLAN_REQUIRED"); await ownApp(ctx, applicationId);
  const t = clip(body, 1500); if (t.length < 2) throw err("Write a note."); await contentDb.prepare("INSERT INTO job_application_notes (id, application_id, company_id, author_handle, body, created_at) VALUES (?,?,?,?,?,?)").run(uid(), applicationId, ctx.c.id, ctx.handle, t, nowIso()); return { ok: true };
}
export async function messageApplicant(ctx, { applicationId, body, links, kind }) {
  need(ctx, "applicants.message"); if (!has(ctx.plan, "applicant_pipeline")) throw err("Messaging candidates is part of Business.", 403, "PLAN_REQUIRED");
  const a = await ownApp(ctx, applicationId), j = await ownJob(ctx, a.job_id), t = clip(body, 3000); if (!t) throw err("Write a message.");
  await addMessage({ applicationId, companyId: ctx.c.id, candidateKey: a.candidate_key, sender: "company", handle: ctx.handle, kind: kind === "request" ? "request" : "text", text: t, links: Array.isArray(links) ? links : [] });
  const acct = await resolveAliasAccountId(a.candidate_key).catch(() => null); if (acct) await createNotification(acct, "job_message", `${ctx.c.name} sent you a message about ${j.title}.`, null).catch(() => {});
  return { ok: true };
}
export async function listMsgTemplates(ctx) { need(ctx, "applicants.message"); return contentDb.prepare("SELECT id, title, body FROM company_msg_templates WHERE company_id = ? ORDER BY title").all(ctx.c.id); }
export async function saveMsgTemplate(ctx, { id, title, body }) {
  need(ctx, "applicants.message"); const t = clip(title, 60), b = clip(body, 2000); if (t.length < 2 || b.length < 5) throw err("Give it a title and some text.");
  if (id) { await contentDb.prepare("UPDATE company_msg_templates SET title = ?, body = ? WHERE id = ? AND company_id = ?").run(t, b, id, ctx.c.id); return { id }; }
  const n = Number((await contentDb.prepare("SELECT COUNT(*) n FROM company_msg_templates WHERE company_id = ?").get(ctx.c.id)).n); if (n >= 40) throw err("You've reached the template limit.", 403, "PLAN_LIMIT");
  const nid = uid(); await contentDb.prepare("INSERT INTO company_msg_templates (id, company_id, title, body, created_by, created_at) VALUES (?,?,?,?,?,?)").run(nid, ctx.c.id, t, b, ctx.handle, nowIso()); return { id: nid };
}
export async function deleteMsgTemplate(ctx, { id }) { need(ctx, "applicants.message"); await contentDb.prepare("DELETE FROM company_msg_templates WHERE id = ? AND company_id = ?").run(id, ctx.c.id); return { ok: true }; }
export async function threadForCompany(ctx, applicationId, since) { need(ctx, "applicants.message"); await ownApp(ctx, applicationId); return threadFor(applicationId, "company", null, since || null); }

export async function proposeInterview(ctx, { applicationId, slots, mode, link, notes, durationMin }) {
  need(ctx, "interviews.manage"); if (!has(ctx.plan, "applicant_pipeline")) throw err("Interview scheduling is part of Business.", 403, "PLAN_REQUIRED");
  const a = await ownApp(ctx, applicationId), j = await ownJob(ctx, a.job_id);
  const s = (Array.isArray(slots) ? slots : []).map((x) => new Date(x)).filter((d) => !isNaN(d) && d.getTime() > Date.now()).map((d) => d.toISOString()).slice(0, 5); if (!s.length) throw err("Offer at least one future time.");
  const lk = clip(link, 400); if (lk && !/^https:\/\/[^\s]+$/.test(lk)) throw err("The meeting link must be https://.");
  const id = uid(); await contentDb.prepare("INSERT INTO job_interviews (id, application_id, company_id, slots, status, mode, link, notes, duration_min, created_by, created_at) VALUES (?,?,?,?,'proposed',?,?,?,?,?,?)").run(id, applicationId, ctx.c.id, JSON.stringify(s), ["video", "phone", "onsite"].includes(mode) ? mode : "video", lk || null, clip(notes, 500) || null, Math.max(15, Math.min(240, Number(durationMin) || 45)), ctx.handle, nowIso());
  if (["new", "screening"].includes(a.stage)) await setStage(a, "interview", null);
  await addMessage({ applicationId, companyId: ctx.c.id, candidateKey: a.candidate_key, sender: "company", handle: ctx.handle, kind: "interview", text: `Interview invitation for ${j.title}: please choose a time that suits you.`, interviewId: id });
  const acct = await resolveAliasAccountId(a.candidate_key).catch(() => null); if (acct) await createNotification(acct, "job_application", `${ctx.c.name} invited you to interview for ${j.title}. Pick a time in My applications.`, null).catch(() => {});
  await auditCompany(ctx.c.id, ctx.handle, "interview_proposed", a.id); return { id };
}
export async function updateInterview(ctx, { interviewId, action }) {
  need(ctx, "interviews.manage"); const i = await contentDb.prepare("SELECT id FROM job_interviews WHERE id = ? AND company_id = ?").get(interviewId, ctx.c.id); if (!i) throw err("Not found.", 404, "NOT_FOUND");
  if (!["completed", "cancelled"].includes(action)) throw err("Unknown action."); await contentDb.prepare("UPDATE job_interviews SET status = ? WHERE id = ?").run(action, interviewId); return { ok: true };
}

// ---- history and intelligence (Business: basic, Business Pro+: advanced)
export async function hiringHistory(ctx) {
  need(ctx, "hiring.insights");
  const since = new Date(Date.now() - 365 * DAY).toISOString();
  const jobs = (await contentDb.prepare("SELECT id, title, status, source, salary_min, salary_max, currency, salary_period, published_at, filled_at, closed_at, created_at FROM jobs WHERE company_id = ? AND source = 'official' AND created_at > ?").all(ctx.c.id, since)).map(mapJob);
  const apps = ctx.can("applicants.view") ? await contentDb.prepare("SELECT job_id, stage FROM job_applications WHERE company_id = ? AND created_at > ?").all(ctx.c.id, since) : [];
  const filledJobs = jobs.filter((j) => j.status === "filled" && j.filled_at && j.published_at), ttf = filledJobs.map((j) => (new Date(j.filled_at) - new Date(j.published_at)) / DAY);
  const titles = {}; for (const j of jobs) { const k = L.transparency ? j.title.toLowerCase().replace(/\b(senior|junior|lead|sr|jr)\b/g, "").trim() : j.title; titles[k] = (titles[k] || 0) + 1; }
  const half = Date.now() - 182 * DAY, a = jobs.filter((j) => new Date(j.created_at) > half).length, b = jobs.length - a;
  const byCur = {}; for (const j of jobs) if (j.salary_min != null && j.currency && j.salary_period) { const k = `${j.currency}/${j.salary_period}`; (byCur[k] ||= []).push((j.salary_min + j.salary_max) / 2); }
  const out = { posted: jobs.length, filled: filledJobs.length, closedUnfilled: jobs.filter((j) => ["closed", "withdrawn", "expired"].includes(j.status)).length, avgDaysToFill: ttf.length ? Math.round(ttf.reduce((x, y) => x + y, 0) / ttf.length) : null,
    avgApplications: jobs.length && apps.length ? Math.round(apps.length / jobs.length) : null, hireRate: apps.length >= 10 ? Math.round((apps.filter((x) => x.stage === "hired").length / apps.length) * 100) : null,
    repeated: Object.entries(titles).filter(([, n]) => n >= 2).map(([title, n]) => ({ title, n })).sort((x, y) => y.n - x.n).slice(0, 5), growth: b >= 3 ? Math.round(((a - b) / b) * 100) : null,
    avgSalary: Object.entries(byCur).map(([k, v]) => ({ unit: k, avg: Math.round(v.reduce((x, y) => x + y, 0) / v.length), n: v.length })).filter((x) => x.n >= 3), survey: await surveyStats(ctx.c.id), transparencyAvg: jobs.length ? Math.round(jobs.reduce((x, j) => x + j.transparency, 0) / jobs.length) : null };
  return out;
}

// ---- AI / deterministic job-description review (Business Pro+)
export async function reviewJob(ctx, jobId) {
  need(ctx, "jobs.post"); if (!has(ctx.plan, "jobs_ai")) throw err("Job-description review is part of Business Pro.", 403, "PLAN_REQUIRED");
  const j = await ownJob(ctx, jobId), t = L.transparency(j), tips = t.items.filter((i) => !i.ok).map((i) => `Add: ${i.label.toLowerCase()} (+${i.pts} transparency).`);
  const sig = L.scamSignals(j); if (sig.length) tips.push(`This could look suspicious to candidates: it ${sig.join("; ")}.`);
  if ((j.description || "").length > 6000) tips.push("The description is very long. Candidates skim: lead with what the person will do.");
  if (/rockstar|ninja|guru|work hard play hard|fast-paced|dynamic environment/i.test(j.description || "")) tips.push("Phrases like “rockstar” or “fast-paced” put candidates off. Say what the pace actually is.");
  if (j.workplace_mode === "hybrid" && j.office_days == null) tips.push("Say how many days are in the office. It's the most common reason people feel misled.");
  let ai = null;
  if (isAiConfigured() && j.description) { try { ai = await callModel({ maxTokens: 300, system: "You review a job posting for clarity, fairness and honesty. Reply with at most 5 short bullet points: vague claims to make specific, wording that may exclude people, and anything a candidate would want to know that is missing. Do not rewrite the posting.", user: `${j.title}\n${j.description}\nRequirements: ${j.requirements.join("; ")}` }); } catch { /* optional */ } }
  return { transparency: t, tips, ai };
}
