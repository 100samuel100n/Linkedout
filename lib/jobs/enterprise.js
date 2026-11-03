// Enterprise and Pro hiring tools: job-level hiring teams, bulk actions, CSV import, promoted jobs, calendar files, retention.
// Promotion is a SEPARATE, labelled slot above search results. It never changes organic rank: a promoted job isn't ranked higher, it is shown elsewhere and says "Promoted".
import crypto from "node:crypto";
import { contentDb } from "../content/db.js";
import { StoryError } from "../stories/service.js";
import { auditCompany } from "../stories/business.js";
import { has, levelOf } from "../business-features.js";
import { repKeyByHandle } from "../stories/business.js";
import { createJob, setJobStatus, jobLog } from "./service.js";
import * as L from "./logic.js";

const nowIso = () => new Date().toISOString(), DAY = 864e5, uid = () => crypto.randomUUID();
const err = (m, s = 400, c = "BAD_REQUEST") => new StoryError(m, s, c);
const need = (ctx, p) => { if (!ctx.can(p)) throw err("Your role on this company can't do that.", 403, "ROLE_FORBIDDEN"); };
const J = (v, f) => { try { return JSON.parse(v) ?? f; } catch { return f; } };

// ---- hiring teams: when a job has a team, only the team (and owners/admins) see its applicants
export const teamAllows = (ctx, job) => { const t = J(job.team, []); return !has(ctx.plan, "hiring_teams") || !t.length || ["owner", "admin"].includes(ctx.role) || t.includes(ctx.handle); };
export async function setTeam(ctx, { jobId, handles }) {
  need(ctx, "jobs.post"); if (!has(ctx.plan, "hiring_teams")) throw err("Hiring teams are part of Enterprise.", 403, "PLAN_REQUIRED");
  const j = await contentDb.prepare("SELECT id FROM jobs WHERE id = ? AND company_id = ?").get(jobId, ctx.c.id); if (!j) throw err("Job not found.", 404, "NOT_FOUND");
  const clean = []; for (const h of (Array.isArray(handles) ? handles : []).slice(0, 15)) if (await repKeyByHandle(ctx.c.id, String(h))) clean.push(String(h));
  await contentDb.prepare("UPDATE jobs SET team = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(clean), nowIso(), jobId); await auditCompany(ctx.c.id, ctx.handle, "job_team_set", `${jobId}: ${clean.length}`); return { ok: true, team: clean };
}
// ---- bulk
export async function bulkStatus(v, ctx, { ids, status }) {
  need(ctx, "jobs.post"); if (!has(ctx.plan, "hiring_teams")) throw err("Bulk job management is part of Enterprise.", 403, "PLAN_REQUIRED");
  let ok = 0, failed = []; for (const id of (Array.isArray(ids) ? ids : []).slice(0, 100)) { try { await setJobStatus(v, id, status); ok++; } catch (e) { failed.push(`${id.slice(0, 6)}: ${e.message}`); } } return { ok, failed };
}
const csvRow = (line) => { const out = []; let cur = "", q = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c; } out.push(cur); return out.map((x) => x.trim()); };
// Header row required. Columns: title, department, location, mode, type, level, salaryMin, salaryMax, currency, period, description, applyUrl
export async function importCsv(v, ctx, { csv }) {
  need(ctx, "jobs.post"); if (!has(ctx.plan, "hiring_teams")) throw err("CSV import is part of Enterprise.", 403, "PLAN_REQUIRED");
  const lines = String(csv || "").split(/\r?\n/).filter((l) => l.trim()); if (lines.length < 2) throw err("Paste a header row and at least one job.");
  const head = csvRow(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z]/g, "")), at = (r, k) => r[head.indexOf(k)] || "";
  if (!head.includes("title")) throw err("The header row needs a “title” column."); const made = [], failed = [];
  for (const [i, line] of lines.slice(1, 51).entries()) {
    const r = csvRow(line);
    try { const out = await createJob(v, { forWhom: "my_company", companyId: ctx.c.id, publish: false, title: at(r, "title"), department: at(r, "department"), locations: at(r, "location"), workplaceMode: at(r, "mode"), employmentType: at(r, "type"), seniority: at(r, "level"), salaryMin: at(r, "salarymin"), salaryMax: at(r, "salarymax"), currency: at(r, "currency"), salaryPeriod: at(r, "period"), description: at(r, "description") || `${at(r, "title")} at ${ctx.c.name}. Full description to follow before this job is published.`.padEnd(50, " "), applicationMethod: at(r, "applyurl") ? "external" : "internal", externalUrl: at(r, "applyurl") }); made.push(out.id); }
    catch (e) { failed.push(`row ${i + 2}: ${e.message}`); }
  }
  await auditCompany(ctx.c.id, ctx.handle, "jobs_imported", `${made.length} drafts`); return { created: made.length, failed, note: "Imported as drafts. Review each one, then publish." };
}
// ---- promoted jobs
export async function promote(ctx, { jobId, on = true, days = 14 }) {
  need(ctx, "jobs.post"); const cap = Number(levelOf(ctx.plan, "promoted_jobs")) || 0; if (!cap) throw err("Promoted jobs are part of Business Pro.", 403, "PLAN_REQUIRED");
  if (!on) { await contentDb.prepare("DELETE FROM job_promotions WHERE job_id = ? AND company_id = ?").run(jobId, ctx.c.id); return { ok: true }; }
  const j = await contentDb.prepare("SELECT id, status, source, transparency, verification FROM jobs WHERE id = ? AND company_id = ?").get(jobId, ctx.c.id); if (!j) throw err("Job not found.", 404, "NOT_FOUND");
  if (j.status !== "published" || j.source !== "official") throw err("Only live official jobs can be promoted.");
  if (j.transparency < 65) throw err("Promoted jobs need a transparency score of at least 65. Add salary, benefits, process and requirements first.");
  const n = Number((await contentDb.prepare("SELECT COUNT(*) n FROM job_promotions WHERE company_id = ? AND ends_at > ? AND job_id <> ?").get(ctx.c.id, nowIso(), jobId)).n); if (n >= cap) throw err(`Your plan allows ${cap} promoted jobs at a time.`, 403, "PLAN_LIMIT");
  const d = Math.max(1, Math.min(30, Math.round(Number(days) || 14)));
  await contentDb.prepare(`INSERT INTO job_promotions (job_id, company_id, starts_at, ends_at) VALUES (?,?,?,?) ON CONFLICT (job_id) DO UPDATE SET starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at`).run(jobId, ctx.c.id, nowIso(), new Date(Date.now() + d * DAY).toISOString());
  await jobLog(jobId, `rep:${ctx.handle}`, "promoted", `${d} days`); return { ok: true };
}
export async function activePromotedIds() { return (await contentDb.prepare("SELECT job_id FROM job_promotions WHERE ends_at > ?").all(nowIso())).map((r) => r.job_id); }
export async function countImpressions(ids) { for (const id of ids) await contentDb.prepare("UPDATE job_promotions SET impressions = impressions + 1 WHERE job_id = ?").run(id).catch(() => {}); }
export async function promotionStats(companyId) { return contentDb.prepare("SELECT job_id, ends_at, impressions FROM job_promotions WHERE company_id = ? AND ends_at > ?").all(companyId, nowIso()); }
// ---- calendar (.ics) for a confirmed interview
const ics = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (t) => String(t || "").replace(/[\\;,]/g, (m) => "\\" + m).replace(/\r?\n/g, "\\n");
export async function icsForInterview(interviewId, { candidateKey = null, companyId = null }) {
  const i = await contentDb.prepare("SELECT i.*, a.candidate_key, j.title, j.company_name FROM job_interviews i JOIN job_applications a ON a.id = i.application_id JOIN jobs j ON j.id = a.job_id WHERE i.id = ?").get(interviewId);
  if (!i || (candidateKey && i.candidate_key !== candidateKey) || (companyId && i.company_id !== companyId)) throw err("Not found.", 404, "NOT_FOUND");
  if (i.status !== "confirmed" || !i.chosen) throw err("This interview isn't confirmed yet.");
  const end = new Date(new Date(i.chosen).getTime() + (i.duration_min || 45) * 60000);
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//LinkedOut//Interview//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT", `UID:${i.id}@linkedout`, `DTSTAMP:${ics(nowIso())}`, `DTSTART:${ics(i.chosen)}`, `DTEND:${ics(end)}`,
    `SUMMARY:${esc(`Interview: ${i.title} at ${i.company_name}`)}`, `DESCRIPTION:${esc(i.notes || "Interview arranged through LinkedOut.")}`, i.link ? `URL:${i.link}` : "", i.link ? `LOCATION:${esc(i.link)}` : "", "BEGIN:VALARM", "TRIGGER:-PT30M", "ACTION:DISPLAY", "DESCRIPTION:Interview in 30 minutes", "END:VALARM", "END:VEVENT", "END:VCALENDAR"].filter(Boolean).join("\r\n");
}
// ---- retention (Enterprise): delete the company's audit trail and alert history after N days. Stories, replies and jobs are never touched.
export async function saveRetention(ctx, { days }) {
  need(ctx, "settings.manage"); if (!has(ctx.plan, "security_controls")) throw err("Retention controls are part of Enterprise.", 403, "PLAN_REQUIRED");
  const d = days === "" || days == null ? null : Math.max(90, Math.min(1095, Math.round(Number(days)))); if (days && !(d >= 90)) throw err("Choose between 90 and 1095 days.");
  await contentDb.prepare(`INSERT INTO company_settings (company_id, audit_retention_days, updated_at) VALUES (?,?,?) ON CONFLICT (company_id) DO UPDATE SET audit_retention_days = EXCLUDED.audit_retention_days, updated_at = EXCLUDED.updated_at`).run(ctx.c.id, d, nowIso());
  await auditCompany(ctx.c.id, ctx.handle, "retention_set", d ? `${d} days` : "default"); return { ok: true };
}
export async function runRetention() {
  const rows = await contentDb.prepare("SELECT company_id, audit_retention_days d FROM company_settings WHERE audit_retention_days IS NOT NULL").all(); let n = 0;
  for (const r of rows) { const cut = new Date(Date.now() - r.d * DAY).toISOString(); n += (await contentDb.prepare("DELETE FROM company_audit WHERE company_id = ? AND created_at < ?").run(r.company_id, cut)).changes; await contentDb.prepare("DELETE FROM company_alert_events WHERE company_id = ? AND created_at < ?").run(r.company_id, cut); }
  return { purged: n };
}
