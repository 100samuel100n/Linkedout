import { pausable } from "@/lib/flags";
import { requireViewer, fail } from "@/lib/stories/http";
import { icsForInterview } from "@/lib/jobs/enterprise";
async function _GET(request) {
  const v = await requireViewer(); if (v.error) return v.error;
  try { return new Response(await icsForInterview(new URL(request.url).searchParams.get("interviewId"), { candidateKey: v.key }), { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'attachment; filename="interview.ics"' } }); } catch (e) { return fail(e); }
}

export const GET = pausable(_GET);
