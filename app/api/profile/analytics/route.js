import { creatorAnalytics } from "@/lib/stories/analytics";
import { requireViewer, json, fail, planRequired } from "@/lib/stories/http";
import { getAnonymousIdsForAccount } from "@/lib/identity/service";
// Creator analytics: OUT PRO. Counts only; nobody who viewed or reacted is ever identifiable.
export async function GET() {
  const v = await requireViewer(); if (v.error) return v.error;
  if (!v.perks.creatorAnalytics) return planRequired("Creator analytics", "OUT PRO");
  try { return json(await creatorAnalytics(await getAnonymousIdsForAccount(v.accountId))); } catch (e) { return fail(e); }
}
