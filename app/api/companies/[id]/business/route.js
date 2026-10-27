import { planOf, insights, benchmark, listReps, createInvite, removeRep, exportCompanyCsv } from "@/lib/stories/business";
import { requireViewer, json, fail } from "@/lib/stories/http";
import { BUSINESS_PLANS } from "@/lib/tiers";

// The company's own console. Representatives only. Aggregates; never authors.
export async function GET(request, { params }) {
  const v = await requireViewer(); if (v.error) return v.error;
  const { id } = await params; const u = new URL(request.url);
  try {
    if (u.searchParams.get("export") === "csv") { const x = await exportCompanyCsv(id, v.key); return new Response(x.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${x.filename}"` } }); }
    const plan = await planOf(id);
    const team = await listReps(id, v.key);
    const out = { plan, plans: BUSINESS_PLANS, reps: team.filter((r) => r.role !== "owner"), team, insights: null, benchmark: null };
    if (plan.perks.insights) out.insights = await insights(id, v.key);
    if (plan.perks.benchmark) out.benchmark = await benchmark(id, v.key);
    return json(out);
  } catch (e) { return fail(e); }
}
export async function POST(request, { params }) {
  const v = await requireViewer(); if (v.error) return v.error;
  const { id } = await params; const b = await request.json().catch(() => ({}));
  try {
    if (b.action === "invite") return json(await createInvite(id, v.key, b.role));
    if (b.action === "remove_rep") return json(await removeRep(id, v.key, b.handle));
    return json({ error: "Unknown action." }, 400);
  } catch (e) { return fail(e); }
}
