import { pausable } from "@/lib/flags";
import { requireViewer, json, fail } from "@/lib/stories/http";
import * as S from "@/lib/jobs/service";
import * as A from "@/lib/jobs/alerts";

// Everything a candidate keeps: applications, saved jobs, preferences, alerts, application messages, interviews, feedback.
async function _GET(request) {
  const v = await requireViewer(); if (v.error) return v.error; const q = new URL(request.url).searchParams, view = q.get("view") || "applications";
  try {
    if (view === "applications") return json({ applications: await S.myApplications(v) });
    if (view === "saved") return json({ jobs: await S.savedJobs(v) });
    if (view === "prefs") return json(await S.getPrefs(v));
    if (view === "alerts") return json({ alerts: await A.listAlerts(v.accountId) });
    if (view === "thread") { const { contentDb } = await import("@/lib/content/db"); const a = await contentDb.prepare("SELECT id FROM job_applications WHERE id = ? AND candidate_key = ?").get(q.get("applicationId"), v.key); if (!a) return json({ error: "Not found." }, 404); return json({ messages: await S.threadFor(a.id, "candidate", v.key, q.get("since") || null) }); }
    if (view === "survey") return json({ questions: S.SURVEY_QUESTIONS });
    return json({ error: "Unknown view." }, 400);
  } catch (e) { return fail(e); }
}
async function _POST(request) {
  const v = await requireViewer(); if (v.error) return v.error; const b = await request.json().catch(() => ({}));
  try {
    switch (b.action) {
      case "prefs.save": return json(await S.setPrefs(v, b));
      case "alert.create": return json(await A.createAlert(v.accountId, b, v.tier === "basic" ? 5 : 20));
      case "alert.delete": return json(await A.deleteAlert(v.accountId, b.id));
      case "alert.toggle": return json(await A.toggleAlert(v.accountId, b.id, !!b.on));
      case "withdraw": return json(await S.withdraw(v, b.applicationId));
      case "message": return json(await S.candidateMessage(v, b.applicationId, b.body, Array.isArray(b.links) ? b.links : []));
      case "interview": return json(await S.respondInterview(v, { interviewId: b.interviewId, action: b.choice, slot: b.slot }));
      case "survey": return json(await S.submitSurvey(v, b.applicationId, b.answers));
      default: return json({ error: "Unknown action." }, 400);
    }
  } catch (e) { return fail(e); }
}

export const GET = pausable(_GET);
export const POST = pausable(_POST);
