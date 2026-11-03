import { addUpdate } from "@/lib/stories/service";
import { requireViewer, limited, json, fail } from "@/lib/stories/http";

// Story updates, corrections and milestones (author only).
// Body: { kind: update|correction|milestone, body, eventOn? }
export async function POST(request, { params }) {
  const v = await requireViewer({ restriction: "posting" }); if (v.error) return v.error;
  const blocked = await limited(v.accountId, "story_update"); if (blocked) return blocked;
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try { return json(await addUpdate(id, v.key, body), 201); } catch (e) { return fail(e); }
}
