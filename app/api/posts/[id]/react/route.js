import { getReactionBreakdown } from "@/lib/content/service";
import { NextResponse, after } from "next/server";
import { toggleReaction, isValidReaction, getPostAnonymousId, setLike } from "@/lib/content/service";
import { getCurrentAccountId } from "@/lib/session";
import { checkRateLimit, checkTargetRateLimit, RateLimitError } from "@/lib/identity/rate-limit";
import { notifyOwnerOfAnonymousId, getOrCreateAlias } from "@/lib/identity/service";
import { bypassesGatesFor } from "@/lib/admin/bypass";

// Emoji reactions only (one per account per post; same emoji again removes it,
// a different one swaps it). The heart is a LIKE now and lives at
// /api/posts/:id/like — a legacy "like"/❤️ here is forwarded to it so old
// clients keep working.
export async function POST(request, { params }) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in to react." }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const raw = body?.reaction;
  const wantsLike = raw === "like" || raw === "❤️" || raw === "\u2764";
  if (!wantsLike && !isValidReaction(raw)) return NextResponse.json({ error: "That isn't a valid reaction." }, { status: 400 });
  try {
    const bypass = await bypassesGatesFor(accountId);
    if (!bypass) { await checkRateLimit(accountId, "react"); if (!wantsLike) await checkTargetRateLimit(accountId, "react", id, { max: 30, windowMs: 10 * 60 * 1000, label: "again" }); }
    const anonKey = (await getOrCreateAlias(accountId)).anonymousId;
    if (wantsLike) {
      const r = await setLike(id, anonKey, null);
      if (!r) return NextResponse.json({ error: "Post not found." }, { status: 404 });
      return NextResponse.json({ liked: r.liked, likeCount: r.likeCount, reactions: { total: 0, top: [] }, myReaction: null });
    }
    const result = await toggleReaction(id, anonKey, raw);
    if (!result) return NextResponse.json({ error: "Post not found." }, { status: 404 });
    if (result.active && !result.previous) after(async () => {
      const owner = await getPostAnonymousId(id);
      if (owner) await notifyOwnerOfAnonymousId(owner, "reaction", `Someone reacted ${raw} to your post.`, id, accountId);
    });
    return NextResponse.json({ reactions: result.reactions, myReaction: result.myReaction });
  } catch (e) {
    if (e instanceof RateLimitError) return NextResponse.json({ error: e.message }, { status: 429, headers: { "Retry-After": String(Math.ceil(e.retryAfterMs / 1000)) } });
    throw e;
  }
}


// Public read: the full emoji breakdown for the "all reactions" sheet.
export async function GET(_request, { params }) {
  const { id } = await params;
  return NextResponse.json(await getReactionBreakdown("post", id));
}
