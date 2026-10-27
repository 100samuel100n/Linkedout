import { addClaimCheck, listClaimChecks } from "@/lib/stories/service";
import { requireViewer, limited, identityFor, json, fail } from "@/lib/stories/http";

export async function GET(_req, { params }) { const { id } = await params; try { return json({ checks: await listClaimChecks(id) }); } catch (e) { return fail(e); } }

// "Reality check": matches | mixed | differs, with an optional short note.
export async function POST(request, { params }) {
  const v = await requireViewer({ restriction: "posting" }); if (v.error) return v.error;
  const blocked = await limited(v.accountId, "claim_check"); if (blocked) return blocked;
  const { id } = await params;
  const b = await request.json().catch(() => ({}));
  try {
    const identity = await identityFor(v.accountId, b.mode);
    return json(await addClaimCheck({ claimId: id, anonymousId: v.key, authorDisplay: identity.displayLabel, verdict: b.verdict, body: b.body }), 201);
  } catch (e) { return fail(e); }
}
