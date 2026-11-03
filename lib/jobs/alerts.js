// Job alerts: saved job searches that notify when a matching job is published. Account-level (identity store), like saved searches.
import crypto from "node:crypto";
import { storiesIdentityReady, identityDb } from "../stories/identity-db.js";
import { contentDb } from "../content/db.js";
import { createNotification } from "../identity/service.js";
import { StoryError } from "../stories/service.js";
import { WORK_MODES, EMPLOYMENT_TYPES } from "./logic.js";

const nowIso = () => new Date().toISOString(), clip = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const COOLDOWN = 10 * 60 * 1000;
export const cleanQuery = (q = {}) => ({ q: clip(q.q, 80), location: clip(q.location, 60), modes: (q.modes || []).filter((m) => WORK_MODES.includes(m)), types: (q.types || []).filter((t) => EMPLOYMENT_TYPES.includes(t)),
  salaryMin: Number(q.salaryMin) > 0 ? Number(q.salaryMin) : null, skills: (q.skills || []).map((s) => clip(s, 40)).filter(Boolean).slice(0, 5), verifiedOnly: !!q.verifiedOnly, transparency: ["good", "excellent"].includes(q.transparency) ? q.transparency : null });
export async function listAlerts(accountId) { await storiesIdentityReady(); return (await identityDb.prepare("SELECT id, label, query, active, created_at FROM job_alerts WHERE account_id = ? ORDER BY created_at DESC").all(accountId)).map((r) => ({ ...r, query: JSON.parse(r.query), active: !!r.active })); }
export async function createAlert(accountId, { label, query }, limit = 5) {
  await storiesIdentityReady(); const q = cleanQuery(query);
  if (!(q.q || q.location || q.modes.length || q.types.length || q.skills.length || q.salaryMin)) throw new StoryError("Add at least a keyword, location or filter.");
  const n = Number((await identityDb.prepare("SELECT COUNT(*) n FROM job_alerts WHERE account_id = ?").get(accountId)).n); if (n >= limit) throw new StoryError(`You can keep ${limit} job alerts.`, 403, "PLAN_LIMIT");
  const id = crypto.randomUUID(); await identityDb.prepare("INSERT INTO job_alerts (id, account_id, label, query, created_at) VALUES (?,?,?,?,?)").run(id, accountId, clip(label, 60) || [q.q, q.location, q.modes.join("/")].filter(Boolean).join(" · "), JSON.stringify(q), nowIso()); return { id };
}
export async function deleteAlert(accountId, id) { await storiesIdentityReady(); await identityDb.prepare("DELETE FROM job_alerts WHERE id = ? AND account_id = ?").run(id, accountId); return { ok: true }; }
export async function toggleAlert(accountId, id, on) { await storiesIdentityReady(); await identityDb.prepare("UPDATE job_alerts SET active = ? WHERE id = ? AND account_id = ?").run(on ? 1 : 0, id, accountId); return { ok: true }; }
export function jobMatches(q, j) {
  const hay = `${j.title} ${j.company_name} ${j.description || ""} ${j.skills || ""} ${j.department || ""}`.toLowerCase();
  if (q.q && !hay.includes(q.q.toLowerCase())) return false;
  if (q.location && !(String(j.locations || "").toLowerCase().includes(q.location.toLowerCase()) || j.workplace_mode === "remote")) return false;
  if (q.modes?.length && !q.modes.includes(j.workplace_mode)) return false;
  if (q.types?.length && !q.types.includes(j.employment_type)) return false;
  if (q.salaryMin && !(Number(j.salary_max) >= q.salaryMin)) return false;
  if (q.verifiedOnly && j.verification !== "verified") return false;
  if (q.transparency && j.transparency < (q.transparency === "excellent" ? 85 : 65)) return false;
  for (const s of q.skills || []) if (!String(j.skills || "").toLowerCase().includes(s.toLowerCase())) return false;
  return true;
}
export async function onJobPublished(jobId) {
  const j = await contentDb.prepare("SELECT * FROM jobs WHERE id = ? AND status = 'published'").get(jobId); if (!j) return;
  await storiesIdentityReady();
  const rows = await identityDb.prepare("SELECT id, account_id, label, query, last_alert_at FROM job_alerts WHERE active = 1 LIMIT 5000").all(); let sent = 0;
  for (const r of rows) {
    if (r.last_alert_at && Date.now() - new Date(r.last_alert_at).getTime() < COOLDOWN) continue;
    if (!jobMatches(JSON.parse(r.query), j)) continue;
    await createNotification(r.account_id, "job_alert", `New job matching “${r.label}”: ${j.title} at ${j.company_name}.`, null).catch(() => {});
    await identityDb.prepare("UPDATE job_alerts SET last_alert_at = ? WHERE id = ?").run(nowIso(), r.id); sent++;
  }
  return { sent };
}
