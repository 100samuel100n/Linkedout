// Housekeeping, run hourly from instrumentation.js and /api/cron/company. Everything here is idempotent.
import { contentDb } from "../content/db.js";
import { normCompany } from "../stories/service.js";
import { createNotification, resolveAliasAccountId } from "../identity/service.js";
import * as L from "./logic.js";
import { mapJob } from "./service.js";
import { runRetention } from "./enterprise.js";

const nowIso = () => new Date().toISOString(), DAY = 864e5;
export async function runJobMaintenance() {
  if (!(await (await import("@/lib/flags")).jobsEnabled())) return { paused: true }; // Jobs paused: no reminders, no emails
  const out = { backfilled: 0, expired: 0, reminded: 0, interviews: 0, surveys: 0 }, now = nowIso();
  // 1. Old jobs (before companies were linked): attach to a company entity when the name matches, never as "verified".
  for (const r of await contentDb.prepare("SELECT * FROM jobs WHERE updated_at IS NULL LIMIT 300").all()) {
    const j = mapJob(r), co = await contentDb.prepare("SELECT id FROM companies WHERE name_norm = ? AND status = 'active'").get(normCompany(r.company_name));
    await contentDb.prepare("UPDATE jobs SET company_id = ?, awaiting_company = ?, transparency = ?, published_at = COALESCE(published_at, created_at), updated_at = ?, application_method = ?, created_by_key = COALESCE(created_by_key, created_by_anonymous_id) WHERE id = ?")
      .run(co?.id || null, co ? 1 : 0, L.transparency(j).score, now, r.external_url ? "external" : "none", r.id); out.backfilled++;
  }
  // 2. Past the deadline: expire (kept as history, never deleted).
  out.expired = (await contentDb.prepare("UPDATE jobs SET status = 'expired', closed_at = ?, updated_at = ? WHERE status = 'published' AND deadline IS NOT NULL AND deadline < ?").run(now, now, now)).changes;
  // 3. Remind people who asked, 48 hours before a saved job closes.
  const soon = await contentDb.prepare("SELECT s.candidate_key, j.id, j.title, j.company_name FROM job_saves s JOIN jobs j ON j.id = s.job_id WHERE s.remind = 1 AND j.status = 'published' AND j.deadline IS NOT NULL AND j.deadline < ? AND j.deadline > ? AND (j.reminded_at IS NULL)").all(new Date(Date.now() + 2 * DAY).toISOString(), now);
  for (const s of soon) { const a = await resolveAliasAccountId(s.candidate_key).catch(() => null); if (a) { await createNotification(a, "job_alert", `${s.title} at ${s.company_name} closes within 2 days.`, null).catch(() => {}); out.reminded++; } }
  if (soon.length) await contentDb.prepare("UPDATE jobs SET reminded_at = ? WHERE status = 'published' AND deadline IS NOT NULL AND deadline < ? AND deadline > ? AND reminded_at IS NULL").run(now, new Date(Date.now() + 2 * DAY).toISOString(), now);
  // 4. Interview reminders: 24 hours before a confirmed interview, to the candidate and the company.
  const iv = await contentDb.prepare("SELECT i.id, i.chosen, i.company_id, a.candidate_key, j.title FROM job_interviews i JOIN job_applications a ON a.id = i.application_id JOIN jobs j ON j.id = a.job_id WHERE i.status = 'confirmed' AND i.reminded_at IS NULL AND i.chosen < ? AND i.chosen > ?").all(new Date(Date.now() + DAY).toISOString(), now);
  for (const i of iv) { await contentDb.prepare("UPDATE job_interviews SET reminded_at = ? WHERE id = ?").run(now, i.id); const a = await resolveAliasAccountId(i.candidate_key).catch(() => null); if (a) await createNotification(a, "job_application", `Reminder: your interview for ${i.title} is within 24 hours.`, null).catch(() => {}); out.interviews++; }
  // 5. Ask for hiring-experience feedback once, when an application ended or has been quiet for three weeks.
  const sv = await contentDb.prepare("SELECT a.id, a.candidate_key, j.title, j.company_name FROM job_applications a JOIN jobs j ON j.id = a.job_id WHERE a.survey_done = 0 AND a.survey_prompted_at IS NULL AND (a.stage IN ('hired','rejected','withdrawn') OR a.created_at < ?) LIMIT 200").all(new Date(Date.now() - 21 * DAY).toISOString());
  for (const s of sv) { await contentDb.prepare("UPDATE job_applications SET survey_prompted_at = ? WHERE id = ?").run(now, s.id); const a = await resolveAliasAccountId(s.candidate_key).catch(() => null); if (a) { await createNotification(a, "job_application", `How was applying to ${s.company_name}? Two minutes, anonymous, and it helps the next candidate.`, null).catch(() => {}); out.surveys++; } }
  out.retention = await runRetention().catch(() => ({ purged: 0 }));
  return out;
}
