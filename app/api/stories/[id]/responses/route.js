import { listResponses, addResponse, removeResponse } from "@/lib/stories/responses";
import { viewer, requireViewer, limited, identityFor, json } from "@/lib/stories/http";
import { StoryError } from "@/lib/stories/service";

const fail = (e) => {
  if (e?.status && e.status < 500) return json({ error: e.message, code: e.code }, e.status);
  if (e instanceof StoryError) return json({ error: e.message, code: e.code }, e.status);
  console.error("[story responses]", e); return json({ error: "Something went wrong." }, 500);
};

// GET: public. Which reply types the author asked for, counts, and the replies.
export async function GET(_req, { params }) {
  const { id } = await params; const v = await viewer();
  try { return json(await listResponses(id, v.key)); } catch (e) { return fail(e); }
}
// POST { kind: support|advice|warn|connect|reply, body, parentId?, mode?: "alias"|"anon" }
export async function POST(request, { params }) {
  const v = await requireViewer({ restriction: "replies" }); if (v.error) return v.error;
  const blocked = await limited(v.accountId, "story_react"); if (blocked) return blocked;
  const { id } = await params; const body = await request.json().catch(() => null);
  if (!body) return json({ error: "Invalid request." }, 400);
  try {
    const identity = await identityFor(v.accountId, body.mode === "anon" ? "anon" : "alias");
    return json(await addResponse(id, identity, body), 201);
  } catch (e) { return fail(e); }
}
// DELETE ?responseId=...  (your own reply, or any reply on your own story)
export async function DELETE(request, { params }) {
  const v = await requireViewer(); if (v.error) return v.error;
  const { id } = await params; const rid = new URL(request.url).searchParams.get("responseId");
  try { return json(await removeResponse(id, rid, v.key)); } catch (e) { return fail(e); }
}
