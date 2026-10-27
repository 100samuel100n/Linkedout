import { NextResponse } from "next/server";
import { votePoll, getPostAnonymousId } from "@/lib/content/service";
import { getCurrentAccountId } from "@/lib/session";
import { getOrCreateAlias, issueContentToken, verifyContentToken, notifyOwnerOfAnonymousId } from "@/lib/identity/service";
import { checkRateLimit, RateLimitError } from "@/lib/identity/rate-limit";

export async function POST(request, { params }) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in to vote." }, { status: 401 });

  try {
    await checkRateLimit(accountId, "react");
  } catch (e) {
    if (e instanceof RateLimitError) {
      return NextResponse.json({ error: e.message }, { status: 429, headers: { "Retry-After": String(Math.ceil(e.retryAfterMs / 1000)) } });
    }
    throw e;
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const optionIndex = Number(body?.optionIndex);
  if (Number.isNaN(optionIndex)) return NextResponse.json({ error: "optionIndex is required." }, { status: 400 });

  const anonKey = (await getOrCreateAlias(accountId)).anonymousId;
  const updated = await votePoll(id, anonKey, optionIndex);
  if (!updated) return NextResponse.json({ error: "Poll or option not found." }, { status: 404 });

  // Only notify on a real new vote, not on the undo-by-tapping-again path
  // — for single-select, updated.myPollVotes goes back to [] right after
  // an undo; for multi-select, this option's index leaves the array.
  if (updated.myPollVotes?.includes(optionIndex)) {
    const postAnonymousId = await getPostAnonymousId(id);
    if (postAnonymousId) {
      const { token } = await issueContentToken(accountId, "alias");
      const identity = await verifyContentToken(token);
      await notifyOwnerOfAnonymousId(postAnonymousId, "poll_vote", `${identity.displayLabel} voted on your poll.`, id, accountId);
    }
  }
  return NextResponse.json(updated);
}
