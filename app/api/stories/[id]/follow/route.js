import { toggleFollowStory } from "@/lib/stories/service";
import { requireViewer, json, fail } from "@/lib/stories/http";

// Story tracking: OUT keeps up to 5, OUT+ and OUT PRO are unlimited.
export async function POST(_req, { params }) {
  const v = await requireViewer(); if (v.error) return v.error;
  const { id } = await params;
  try { return json(await toggleFollowStory(id, v.key, Number.isFinite(v.perks.trackedStories) ? v.perks.trackedStories : null)); } catch (e) { return fail(e); }
}
