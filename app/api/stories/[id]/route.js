import { getStory, deleteStory, setOutcome, createStory } from "@/lib/stories/service";
import { identityRisk } from "@/lib/stories/redact";
import { identityFor } from "@/lib/stories/http";
import { verifiedMap } from "@/lib/stories/verify";
import { viewer, requireViewer, json, fail } from "@/lib/stories/http";
import { recordView } from "@/lib/stories/analytics";
import { recordItemView } from "@/lib/views";

export async function GET(request, { params }) {
  const { id } = await params;
  const v = await viewer();
  const s = await getStory(id, v.key);
  if (!s) return json({ error: "We couldn't find that story." }, 404);
  if (s.status === "published") recordView(id, v.key, s.isOwner ? v.key : null, request.headers.get("x-forwarded-for")).catch(() => {});
  if (s.status === "published") recordItemView("story", id, { viewerId: v.accountId, bucket: request.headers.get("x-forwarded-for") || "", isOwner: !!s.isOwner }).catch(() => {});
  return json(s);
}
export async function PATCH(request, { params }) {
  const v = await requireViewer(); if (v.error) return v.error;
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try { return json(await setOutcome(id, v.key, body.outcome)); } catch (e) { return fail(e); }
}
export async function DELETE(_req, { params }) {
  const v = await requireViewer(); if (v.error) return v.error;
  const { id } = await params;
  try { return json(await deleteStory(id, v.key)); } catch (e) { return fail(e); }
}

// Edit a private draft or scheduled story, and optionally publish it (status omitted => publish/schedule).
export async function PUT(request, { params }) {
  const v = await requireViewer({ restriction: "posting" }); if (v.error) return v.error;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "Invalid request." }, 400);
  if (body.publishAt && !v.perks.scheduledPublishing) return json({ error: "Scheduled publishing is part of OUT+.", code: "PLAN_REQUIRED", plan: "OUT+" }, 403);
  try {
    const identity = await identityFor(v.accountId, body.mode);
    const out = await createStory(body, identity, { verified: await verifiedMap(v.accountId), replaceId: id });
    const story = await getStory(out.id, v.key);
    return json({ story, redactions: out.redactions, noindex: out.noindex });
  } catch (e) { return fail(e); }
}
