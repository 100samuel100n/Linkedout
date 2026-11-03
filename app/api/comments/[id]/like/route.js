import { NextResponse, after } from "next/server";
import { setCommentLike } from "@/lib/content/service";
import { getCurrentAccountId } from "@/lib/session";
import { checkRateLimit, RateLimitError } from "@/lib/identity/rate-limit";
import { notifyOwnerOfAnonymousId, getOrCreateAlias } from "@/lib/identity/service";

// Comment likes: own table and count, separate from comment reactions.
// Idempotent with { on }, light payload, notification after the response.
export async function POST(request, { params }) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in to like." }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const [alias] = await Promise.all([getOrCreateAlias(accountId), checkRateLimit(accountId, "react")]);
    const r = await setCommentLike(id, alias.anonymousId, typeof body.on === "boolean" ? body.on : null);
    if (!r) return NextResponse.json({ error: "Comment not found." }, { status: 404 });
    if (r.newlyLiked && r.ownerAnonymousId) after(() => notifyOwnerOfAnonymousId(r.ownerAnonymousId, "reaction", "Someone liked your reply.", r.postId, accountId));
    return NextResponse.json({ liked: r.liked, likeCount: r.likeCount });
  } catch (e) {
    if (e instanceof RateLimitError) return NextResponse.json({ error: e.message }, { status: 429, headers: { "Retry-After": String(Math.ceil(e.retryAfterMs / 1000)) } });
    throw e;
  }
}
