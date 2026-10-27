import { NextResponse } from "next/server";
import { setRepost, getPostAnonymousId } from "@/lib/content/service";
import { getCurrentAccountId } from "@/lib/session";
import { issueContentToken, verifyContentToken, notifyOwnerOfAnonymousId, getAnonymousIdsForAccount, checkAndAwardBadges, getOrCreateAlias } from "@/lib/identity/service";
import { countRepostsByAnonymousIds } from "@/lib/content/service";
import { checkRateLimit, checkTargetRateLimit, RateLimitError } from "@/lib/identity/rate-limit";

const VALID_MODES = new Set(["real", "alias", "anon"]);

function limited(e) {
  return NextResponse.json({ error: e.message, code: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": String(Math.ceil(e.retryAfterMs / 1000)) } });
}

// Repost is a toggle: one repost per account per post, enforced by the
// database (reposts has UNIQUE(post_id, anon_key)).
//   POST   { on?: boolean, quoteText?, mode? }  on=true  -> repost
//                                              on=false -> un-repost
//                                              omitted  -> flip current state
//   DELETE                                            -> un-repost
// A repost is a real post row attributed to the reposter, so it shows on
// their profile with no special casing; un-reposting deletes that row.
async function handle(request, params, forcedOn) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in to repost." }, { status: 401 });

  const { id } = await params;
  const body = forcedOn === undefined ? await request.json().catch(() => ({})) : {};
  const on = forcedOn !== undefined ? forcedOn : typeof body?.on === "boolean" ? body.on : null;
  const quoteText = body?.quoteText?.trim() || null;

  try {
    await checkRateLimit(accountId, "repost");
    // Same account + same post can only be changed 6 times an hour, so it
    // can't be flapped on/off to spam the author's notifications.
    await checkTargetRateLimit(accountId, "repost", id, { max: 6, windowMs: 60 * 60 * 1000, label: "again" });
  } catch (e) {
    if (e instanceof RateLimitError) return limited(e);
    throw e;
  }

  // The dedup key is the account's stable alias id no matter which
  // display mode the repost is shown under.
  const alias = await getOrCreateAlias(accountId);
  const mode = VALID_MODES.has(body?.mode) ? body.mode : "alias";
  const { token } = await issueContentToken(accountId, mode);
  const identity = await verifyContentToken(token);

  const result = await setRepost({
    postId: id, anonKey: alias.anonymousId, on, quoteText,
    authorDisplay: identity.displayLabel, anonymousId: identity.anonymousId,
  });
  if (result.error === "NOT_FOUND") return NextResponse.json({ error: "Post not found." }, { status: 404 });
  if (result.error === "IS_REPOST") return NextResponse.json({ error: "Can't repost a repost — repost the original instead." }, { status: 400 });

  if (result.created) {
    const originalAnonymousId = await getPostAnonymousId(id);
    if (originalAnonymousId) {
      await notifyOwnerOfAnonymousId(originalAnonymousId, "repost", `${identity.displayLabel} reposted your post.`, id, accountId);
    }
    const anonymousIds = await getAnonymousIdsForAccount(accountId);
    await checkAndAwardBadges(accountId, { repostCount: await countRepostsByAnonymousIds(anonymousIds) });
  }

  return NextResponse.json({ reposted: result.reposted, repostCount: result.repostCount, post: result.post }, { status: result.created ? 201 : 200 });
}

export async function POST(request, { params }) {
  return handle(request, params, undefined);
}

export async function DELETE(request, { params }) {
  return handle(request, params, false);
}
