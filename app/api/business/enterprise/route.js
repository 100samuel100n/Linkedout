import { createLead } from "@/lib/stories/business";
import { throttle } from "@/lib/identity/throttle-http";
import { json, fail } from "@/lib/stories/http";
// Public contact form for Enterprise. Throttled by IP; the lead (with email) is kept account-side.
export async function POST(request) {
  const limited = await throttle(request, [["ip", null, "enterprise_lead", { max: 5, windowMs: 60 * 60 * 1000, label: "enquiries" }]]);
  if (limited) return limited;
  const b = await request.json().catch(() => ({}));
  try { return json(await createLead(b), 201); } catch (e) { return fail(e); }
}
