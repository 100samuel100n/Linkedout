// Aggregates of the anonymous hiring-experience survey. A company sees results only from 5 answers.
import { contentDb } from "../content/db.js";
const MIN = 5;
const J = (v) => { try { return JSON.parse(v); } catch { return {}; } };
export async function surveyStats(companyId) {
  const rows = (await contentDb.prepare("SELECT answers FROM hiring_surveys WHERE company_id = ?").all(companyId)).map((r) => J(r.answers));
  if (rows.length < MIN) return { ready: false, responses: rows.length, note: `Shown once at least ${MIN} candidates have answered (${rows.length} so far).` };
  const yes = (k) => { const v = rows.map((r) => r[k]).filter((x) => x === 0 || x === 1); return v.length >= MIN ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) : null; };
  const speed = {}; for (const r of rows) if (r.speed) speed[r.speed] = (speed[r.speed] || 0) + 1;
  return { ready: true, responses: rows.length, communicated: yes("communicated"), expectations: yes("expectations"), salary: yes("salary"), respectful: yes("respectful"), matched: yes("matched"), ghosted: yes("ghosted"), speed };
}
