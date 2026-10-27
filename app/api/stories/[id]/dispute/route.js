import { fileDispute } from "@/lib/stories/service";
import { viewer, limited, json, fail } from "@/lib/stories/http";

// Anyone — including a person mentioned in a story — can ask for a story to be reviewed.
export async function POST(request, { params }) {
  const v = await viewer();
  if (v.accountId) { const b = await limited(v.accountId, "story_dispute"); if (b) return b; }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try { return json(await fileDispute({ storyId: id, reporterKey: v.key, role: body.role, reason: body.reason, details: body.details }), 201); } catch (e) { return fail(e); }
}
