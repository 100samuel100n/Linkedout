import { pausable } from "@/lib/flags";
import { viewer, requireViewer, json, fail } from "@/lib/stories/http";
import * as S from "@/lib/jobs/service";
import { getAccountById } from "@/lib/identity/service";

async function _GET(request, { params }) { const { id } = await params; const v = await viewer(); try { return json(await S.getJob(id, v)); } catch (e) { return fail(e); } }
async function _PATCH(request, { params }) { const { id } = await params; const v = await requireViewer(); if (v.error) return v.error; const b = await request.json().catch(() => ({})); try { return json(await S.updateJob(v, id, b)); } catch (e) { return fail(e); } }
async function _POST(request, { params }) {
  const { id } = await params; const v = await requireViewer(); if (v.error) return v.error; const b = await request.json().catch(() => ({}));
  try {
    switch (b.action) {
      case "status": return json(await S.setJobStatus(v, id, b.status));
      case "claim": return json(await S.claimJob(v, id));
      case "save": return json(await S.toggleSave(v, id, !!b.remind));
      case "interest": return json(await S.toggleInterest(v, id));
      case "report": return json(await S.reportJob(v, id, b));
      case "apply": return json(await S.apply(v, id, b));
      default: return json({ error: "Unknown action." }, 400);
    }
  } catch (e) { return fail(e); }
}

export const GET = pausable(_GET);
export const PATCH = pausable(_PATCH);
export const POST = pausable(_POST);
