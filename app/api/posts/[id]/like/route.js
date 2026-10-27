import { NextResponse, after } from "next/server";
import { setLike, getPostAnonymousId } from "@/lib/content/service";
import { getCurrentAccountId } from "@/lib/session";
import { checkRateLimit, RateLimitError } from "@/lib/identity/rate-limit";
import { notifyOwnerOfAnonymousId, getOrCreateAlias } from "@/lib/identity/service";
import { bypassesGatesFor } from "@/lib/admin/bypass";

// Likes are separate from emoji reactions (own table, own count). Body
// { on: true|false } is idempotent, so rapid taps / retries can't flip state.
// Kept deliberately light — one rate-limit insert, one alias lookup, a couple of
// tiny queries — and the owner notification runs AFTER the response is sent.
export async function POST(request, { params }) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in to like." }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const [alias] = await Promise.all([getOrCreateAlias(accountId), (async () => { if (!(await bypassesGatesFor(accountId))) await checkRateLimit(accountId, "react"); })()]);
    const res = await setLike(id, alias.anonymousId, typeof body.on === "boolean" ? body.on : null);
    if (!res) return NextResponse.json({ error: "Post not found." }, { status: 404 });
    if (res.newlyLiked) after(async () => {
      const owner = await getPostAnonymousId(id);
      if (owner) await notifyOwnerOfAnonymousId(owner, "reaction", "Someone liked your post.", id, accountId);
    });
    return NextResponse.json({ liked: res.liked, likeCount: res.likeCount });
  } catch (e) {
    if (e instanceof RateLimitError) return NextResponse.json({ error: e.message }, { status: 429, headers: { "Retry-After": String(Math.ceil(e.retryAfterMs / 1000)) } });
    throw e;
  }
}
