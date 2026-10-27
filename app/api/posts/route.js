import { NextResponse } from "next/server";
import { restrictionError } from "@/lib/admin/enforce";
import { getPosts, createPost, countPostsByAnonymousIds, attachMediaToPost } from "@/lib/content/service";
import { savePostMedia } from "@/lib/media";
import { getCurrentAccountId } from "@/lib/session";
import { issueContentToken, verifyContentToken, getOrCreateAlias, getAnonymousIdsForAccount, checkAndAwardBadges } from "@/lib/identity/service";
import { claimOnce, releaseClaim, fingerprint } from "@/lib/idempotency";
import { checkRateLimit, RateLimitError } from "@/lib/identity/rate-limit";

const VALID_MODES = new Set(["real", "alias", "anon"]);

export async function GET(request) {
  const accountId = await getCurrentAccountId();
  let viewerAnonKey = null;
  if (accountId) {
    viewerAnonKey = (await getOrCreateAlias(accountId)).anonymousId;
  }
  const url = new URL(request.url);
  const includeScheduled = url.searchParams.get("includeScheduled") === "1";
  const includeScheduledForAnonymousIds = includeScheduled && accountId ? await getAnonymousIdsForAccount(accountId) : null;
  const limit = Number(url.searchParams.get("limit")) || 40;
  const before = url.searchParams.get("before") || null;
  return NextResponse.json(await getPosts({ viewerAnonKey, includeScheduledForAnonymousIds, limit, before }));
}

export async function POST(request) {
  const accountId = await getCurrentAccountId();
  { const blocked = accountId && await restrictionError(accountId, "posting"); if (blocked) return blocked; }
  if (!accountId) {
    return NextResponse.json({ error: "You need to be logged in to post." }, { status: 401 });
  }

  try {
    await checkRateLimit(accountId, "post");
  } catch (e) {
    if (e instanceof RateLimitError) {
      return NextResponse.json({ error: e.message }, { status: 429, headers: { "Retry-After": String(Math.ceil(e.retryAfterMs / 1000)) } });
    }
    throw e;
  }

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Invalid form data." }, { status: 400 });

  const text = (form.get("text") || "").toString().trim();
  const type = (form.get("type") || "rant").toString();
  if (!text && type !== "poll") {
    return NextResponse.json({ error: "Post text is required." }, { status: 400 });
  }
  const mode = VALID_MODES.has(form.get("mode")) ? form.get("mode").toString() : "alias";
  // Same account + same content inside 20 s is a double click or a retry, never a second post.
  const dupKey = `post:${accountId}:${await fingerprint(type, text, form.get("title"), form.get("pollOptions"))}`;
  if (!claimOnce(dupKey)) return NextResponse.json({ error: "That post is already being published.", duplicate: true }, { status: 409 });
  const mediaFile = form.get("media");
  const pollOptionsRaw = form.get("pollOptions");
  const tagsRaw = form.get("tags");
  const scheduledAt = form.get("scheduledAt") ? new Date(form.get("scheduledAt").toString()).toISOString() : null;
  if (scheduledAt && new Date(scheduledAt).getTime() < Date.now()) {
    return NextResponse.json({ error: "Scheduled time must be in the future." }, { status: 400 });
  }

  // This is the identity/content boundary in action: the account id never
  // leaves this function. We ask the identity service for a short-lived
  // content token (anonymousId + displayLabel only), and only that goes
  // into the post.
  const { token } = await issueContentToken(accountId, mode);
  const identity = await verifyContentToken(token);

  let post;
  try { post = await createPost({
    type,
    mood: (form.get("mood") || "Chaotic Neutral").toString(),
    text,
    tags: tagsRaw ? JSON.parse(tagsRaw.toString()) : [],
    authorDisplay: identity.displayLabel,
    anonymousId: identity.anonymousId,
    title: form.get("title") ? form.get("title").toString() : null,
    category: form.get("category") ? form.get("category").toString() : null,
    visibility: form.get("visibility") ? form.get("visibility").toString() : "public",
    scheduledAt,
    eventAt: form.get("eventAt") ? new Date(form.get("eventAt").toString()).toISOString() : null,
    eventLocation: form.get("eventLocation") ? form.get("eventLocation").toString() : null,
    pollOptions: pollOptionsRaw ? JSON.parse(pollOptionsRaw.toString()) : null,
    multiSelect: form.get("multiSelect") === "1",
    cringeNominated: form.get("cringeNominated") === "1",
  }); } catch (e) { releaseClaim(dupKey); throw e; }

  // Media is saved AFTER the post exists (the file is named after the
  // post's real id), then the row is updated with the resulting path.
  if (mediaFile && typeof mediaFile !== "string") {
    try {
      const { url, kind } = await savePostMedia(post.id, mediaFile);
      post = await attachMediaToPost(post.id, kind, url);
    } catch (e) {
      // Post already exists without media rather than failing the whole
      // request — a partial success (text posted, attachment rejected) is
      // more honest than silently losing the user's text too.
      return NextResponse.json({ ...post, mediaError: e.message }, { status: 201 });
    }
  }

  const anonymousIds = await getAnonymousIdsForAccount(accountId);
  await checkAndAwardBadges(accountId, { postCount: await countPostsByAnonymousIds(anonymousIds) });

  return NextResponse.json(post, { status: 201 });
}
