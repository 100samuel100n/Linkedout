import { addClaim } from "@/lib/stories/service";
import { requireViewer, limited, json, fail } from "@/lib/stories/http";

// Reality Check: someone quotes a claim a company makes ("We have unlimited PTO").
// Body: { claim, topic? }. A verified company owner's claims are labelled as the company's own.
export async function POST(request, { params }) {
  const v = await requireViewer({ restriction: "posting" }); if (v.error) return v.error;
  const blocked = await limited(v.accountId, "claim_create"); if (blocked) return blocked;
  const { id } = await params;
  const b = await request.json().catch(() => ({}));
  try { return json(await addClaim({ companyId: id, topic: b.topic, claim: b.claim, submittedBy: v.key, source: b.asCompany ? "company" : "user" }), 201); } catch (e) { return fail(e); }
}
