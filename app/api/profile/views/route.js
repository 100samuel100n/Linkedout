import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { getAccountById, getProfileViewsFor } from "@/lib/identity/service";
import { effectiveTier } from "@/lib/tiers";

// Who viewed your profile + profile analytics, gated by plan in the service.
export async function GET() {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "Log in first." }, { status: 401 });
  const account = await getAccountById(accountId);
  return NextResponse.json(await getProfileViewsFor(accountId, effectiveTier(account)));
}
