import { addPublicRecord } from "@/lib/stories/service";
import { requireStaff } from "@/lib/admin/guard";
import { json, fail } from "@/lib/stories/http";

// Staff adds a "publicly documented" record (with a source link). This — not user volume —
// is the only thing that moves a layoff from "User-reported" to "Publicly documented".
export async function POST(request) {
  const g = await requireStaff("companies.manage"); if (g.error) return g.error;
  const b = await request.json().catch(() => ({}));
  try { return json(await addPublicRecord({ ...b, addedBy: g.staff.id }), 201); } catch (e) { return fail(e); }
}
