import { startWorkEmail } from "@/lib/stories/verify";
import { requireViewer, limited, json, fail } from "@/lib/stories/http";
export async function POST(request) {
  const v = await requireViewer(); if (v.error) return v.error;
  const blocked = await limited(v.accountId, "emp_verify"); if (blocked) return blocked;
  const b = await request.json().catch(() => ({}));
  try { return json(await startWorkEmail(v.accountId, b)); } catch (e) { return fail(e); }
}
