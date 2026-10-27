import { getReactionBreakdown } from "@/lib/content/service";
import { NextResponse } from "next/server";
import { toggleCommentReaction, isValidReaction, setCommentLike } from "@/lib/content/service";
import { getCurrentAccountId } from "@/lib/session";
import { checkRateLimit, checkTargetRateLimit, RateLimitError } from "@/lib/identity/rate-limit";
import { notifyOwnerOfAnonymousId, getOrCreateAlias } from "@/lib/identity/service";

export async function POST(request, { params }) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in to react." }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const reaction = body?.reaction;
  if (reaction === "like" || reaction === "❤️") { // hearts are Likes now — forward for older clients
    const anonKey0 = (await getOrCreateAlias(accountId)).anonymousId;
    const r0 = await setCommentLike(id, anonKey0, null);
    if (!r0) return NextResponse.json({ error: "Comment not found." }, { status: 404 });
    return NextResponse.json({ liked: r0.liked, likeCount: r0.likeCount, reactions: { total: 0, top: [] }, myReaction: null });
  }
  if (!isValidReaction(reaction)) return NextResponse.json({ error: "That isn't a valid reaction." }, { status: 400 });
  try {
    await checkRateLimit(accountId, "react");
    await checkTargetRateLimit(accountId, "creact", id, { max: 12, windowMs: 10 * 60 * 1000, label: "again" });
  } catch (e) {
    if (e instanceof RateLimitError) return NextResponse.json({ error: e.message }, { status: 429, headers: { "Retry-After": String(Math.ceil(e.retryAfterMs / 1000)) } });
    throw e;
  }
  const anonKey = (await getOrCreateAlias(accountId)).anonymousId;
  const result = await toggleCommentReaction(id, anonKey, reaction);
  if (!result) return NextResponse.json({ error: "Comment not found." }, { status: 404 });
  if (result.active && result.ownerAnonymousId) {
    await notifyOwnerOfAnonymousId(result.ownerAnonymousId, "reaction", `Someone reacted ${reaction} to your reply.`, result.postId, accountId);
  }
  return NextResponse.json({ reactions: result.reactions, myReaction: result.myReaction });
}


// Public read: the full emoji breakdown for the "all reactions" sheet.
export async function GET(_request, { params }) {
  const { id } = await params;
  return NextResponse.json(await getReactionBreakdown("comment", id));
}
