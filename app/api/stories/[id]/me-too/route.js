import { setMeToo } from "@/lib/stories/service";
import { requireViewer, limited, json, fail } from "@/lib/stories/http";
import { notifyMeTooMilestone } from "@/lib/stories/notify";

// "This happened to me too" / "I experienced something similar" / off.
// Body: { kind: "same"|"similar"|"off", sameCompany: bool }
export async function POST(request, { params }) {
  const v = await requireViewer({ restriction: "posting" }); if (v.error) return v.error;
  const blocked = await limited(v.accountId, "story_react"); if (blocked) return blocked;
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const result = await setMeToo(id, v.key, { kind: body.kind, sameCompany: !!body.sameCompany });
    if (body.kind !== "off") notifyMeTooMilestone(id, result.total).catch(() => {});
    return json(result);
  } catch (e) { return fail(e); }
}
