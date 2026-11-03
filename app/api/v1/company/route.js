import { NextResponse } from "next/server";
import { authApiKey, apiResource } from "@/lib/stories/company-extras";

// Read-only company API (Enterprise). Authorization: Bearer lo_live_…   GET /api/v1/company?resource=reputation|benchmarks|alerts|stories|jobs
// Same aggregates as the dashboard. No author, salary submitter or voter is ever included.
export async function GET(request) {
  const h = request.headers.get("authorization") || "";
  try {
    const ctx = await authApiKey(h.replace(/^Bearer\s+/i, ""));
    if (!ctx) return NextResponse.json({ error: "Invalid or revoked API key." }, { status: 401 });
    const data = await apiResource(ctx, new URL(request.url).searchParams.get("resource") || "reputation");
    return NextResponse.json({ company: { id: ctx.c.id, name: ctx.c.name }, data }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return NextResponse.json({ error: e.message || "Request failed." }, { status: e.status || 500 }); }
}
