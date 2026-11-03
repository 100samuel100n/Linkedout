import { NextResponse } from "next/server";
import { restrictionError } from "@/lib/admin/enforce";
import { createComment, getComments, getPostAnonymousId, countCommentsByAnonymousIds, attachMediaToComment } from "@/lib/content/service";
import { savePostMedia } from "@/lib/media";
import { getCurrentAccountId } from "@/lib/session";
import { issueContentToken, verifyContentToken, notifyOwnerOfAnonymousId, getAnonymousIdsForAccount, checkAndAwardBadges, getOrCreateAlias } from "@/lib/identity/service";
import { checkRateLimit, RateLimitError } from "@/lib/identity/rate-limit";

const VALID_MODES = new Set(["real", "alias", "anon"]);

export async function GET(request, { params }) {
  const { id } = await params;
  const accountId = await getCurrentAccountId();
  const viewerKey = accountId ? (await getOrCreateAlias(accountId)).anonymousId : null;
  return NextResponse.json(await getComments(id, viewerKey));
}

export async function POST(request, { params }) {
  const accountId = await getCurrentAccountId();
  { const blocked = accountId && await restrictionError(accountId, "replies"); if (blocked) return blocked; }
  if (!accountId) return NextResponse.json({ error: "You need to be logged in to comment." }, { status: 401 });

  try {
    await checkRateLimit(accountId, "react");
  } catch (e) {
    if (e instanceof RateLimitError) {
      return NextResponse.json({ error: e.message }, { status: 429, headers: { "Retry-After": String(Math.ceil(e.retryAfterMs / 1000)) } });
    }
    throw e;
  }

  const { id } = await params;

  // Two shapes are accepted: a plain JSON body (text/gifUrl only — what
  // the quick-reply box sends) or multipart form data (when a file's
  // attached — same reasoning as the main post composer: the file needs
  // a real request body, JSON can't carry it).
  const contentType = request.headers.get("content-type") || "";
  let text, mode, gifUrl, mediaFile;
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
    text = (form.get("text") || "").toString().trim();
    mode = VALID_MODES.has(form.get("mode")) ? form.get("mode").toString() : "alias";
    gifUrl = form.get("gifUrl") ? form.get("gifUrl").toString() : null;
    mediaFile = form.get("media");
  } else {
    const body = await request.json().catch(() => null);
    text = body?.text?.trim() || "";
    mode = VALID_MODES.has(body?.mode) ? body.mode : "alias";
    gifUrl = body?.gifUrl || null;
  }

  if (!text && !gifUrl && !(mediaFile && typeof mediaFile !== "string")) {
    return NextResponse.json({ error: "A reply needs text, a GIF, or an attachment." }, { status: 400 });
  }

  const { token } = await issueContentToken(accountId, mode);
  const identity = await verifyContentToken(token);

  let comment = await createComment({ postId: id, anonymousId: identity.anonymousId, authorDisplay: identity.displayLabel, text, gifUrl });
  if (!comment) return NextResponse.json({ error: "Post not found." }, { status: 404 });

  if (mediaFile && typeof mediaFile !== "string") {
    try {
      const { url, kind } = await savePostMedia(`comment-${comment.id}`, mediaFile);
      comment = await attachMediaToComment(comment.id, kind, url);
    } catch (e) {
      return NextResponse.json({ ...comment, mediaError: e.message }, { status: 201 });
    }
  }

  const postAnonymousId = await getPostAnonymousId(id);
  if (postAnonymousId) {
    await notifyOwnerOfAnonymousId(postAnonymousId, "comment", `${identity.displayLabel} commented on your post.`, id, accountId);
  }

  const anonymousIds = await getAnonymousIdsForAccount(accountId);
  await checkAndAwardBadges(accountId, { commentCount: await countCommentsByAnonymousIds(anonymousIds) });

  return NextResponse.json(comment, { status: 201 });
}
