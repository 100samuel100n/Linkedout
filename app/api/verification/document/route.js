import { submitDocument } from "@/lib/stories/verify";
import { requireViewer, limited, json, fail } from "@/lib/stories/http";
export async function POST(request) {
  const v = await requireViewer(); if (v.error) return v.error;
  const blocked = await limited(v.accountId, "emp_verify"); if (blocked) return blocked;
  const f = await request.formData().catch(() => null); if (!f) return json({ error: "Invalid upload." }, 400);
  try { return json(await submitDocument(v.accountId, { companyId: f.get("companyId") || null, companyName: f.get("companyName"), kind: f.get("kind"), file: f.get("file") }), 201); } catch (e) { return fail(e); }
}
