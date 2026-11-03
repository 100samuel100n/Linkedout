import { requireViewer, json, fail } from "@/lib/stories/http";
import { setAdvocacy } from "@/lib/stories/company-extras";
// A verified employee chooses whether "Verified employee at Company X" counts toward the company's public tally.
export async function POST(request) {
  const v = await requireViewer(); if (v.error) return v.error; const b = await request.json().catch(() => ({}));
  try { return json(await setAdvocacy(v.accountId, { verificationId: b.verificationId, visible: !!b.visible })); } catch (e) { return fail(e); }
}
