import { manageOverview, manageAction } from "@/lib/stories/circles";
import { requireViewer, limited, json, fail } from "@/lib/stories/http";

// Owner / moderator tools. Members appear only as stable handles (member-ab12cd) so moderating
// never unmasks anyone. Every action is written to the circle's audit log.
export async function GET(_req, { params }) { const v = await requireViewer(); if (v.error) return v.error; const { slug } = await params; try { return json(await manageOverview(slug, v.key)); } catch (e) { return fail(e); } }
export async function POST(request, { params }) {
  const v = await requireViewer(); if (v.error) return v.error;
  const blocked = await limited(v.accountId, "circle_manage"); if (blocked) return blocked;
  const { slug } = await params; const b = await request.json().catch(() => ({}));
  try { return json(await manageAction(slug, v.key, b)); } catch (e) { return fail(e); }
}
