import { addCompanyResponse } from "@/lib/stories/service";
import { requireViewer, limited, json, fail } from "@/lib/stories/http";

// Right of reply. Verified company owners respond to a story (storyId) or publish
// "Here's our explanation" on the company timeline (no storyId). Never removes a story.
export async function POST(request, { params }) {
  const v = await requireViewer(); if (v.error) return v.error;
  const blocked = await limited(v.accountId, "company_reply"); if (blocked) return blocked;
  const { id } = await params;
  const b = await request.json().catch(() => ({}));
  try { return json(await addCompanyResponse({ companyId: id, ownerKey: v.key, storyId: b.storyId || null, body: b.body }), 201); } catch (e) { return fail(e); }
}
