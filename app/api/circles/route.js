import { listCircles, createCircle } from "@/lib/stories/circles";
import { viewer, requireViewer, limited, identityFor, json, fail } from "@/lib/stories/http";

export async function GET(request) {
  const v = await viewer();
  try { return json({ circles: await listCircles(v.key, { mineOnly: new URL(request.url).searchParams.get("mine") === "1" }), canCreate: v.perks.circlesCreate || 0 }); } catch (e) { return fail(e); }
}
// Start a circle. OUT+: 1 circle. OUT PRO: up to 5, can be unlisted.
export async function POST(request) {
  const v = await requireViewer({ restriction: "posting" }); if (v.error) return v.error;
  const blocked = await limited(v.accountId, "circle_create"); if (blocked) return blocked;
  const b = await request.json().catch(() => ({}));
  try { return json(await createCircle(b, await identityFor(v.accountId, "alias"), v.perks), 201); } catch (e) { return fail(e); }
}
