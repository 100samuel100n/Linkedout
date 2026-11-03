import { NextResponse } from "next/server";
import { PLANS, PLAN_COMPARISON, messagingFor } from "@/lib/tiers";
import { refreshPlanConfig } from "@/lib/plan-config";

// Public, live plan data (names, display prices, comparison rows). The web plan page and the native plan screen
// both render from this, so an admin edit in Plan limits & prices shows up on every surface at once.
export async function GET() {
  await refreshPlanConfig();
  return NextResponse.json(
    { plans: PLANS, comparison: PLAN_COMPARISON, messaging: { basic: messagingFor("basic"), plus: messagingFor("plus"), pro: messagingFor("pro") } },
    { headers: { "Cache-Control": "public, max-age=20, stale-while-revalidate=60" } }
  );
}
