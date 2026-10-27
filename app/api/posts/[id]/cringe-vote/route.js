import { NextResponse } from "next/server";
import { voteCringe, getTopCringePostAnonymousId } from "@/lib/content/service";
import { getCurrentAccountId } from "@/lib/session";
import { getOrCreateAlias, checkAndAwardBadgesForAnonymousId } from "@/lib/identity/service";
import { checkRateLimit, RateLimitError } from "@/lib/identity/rate-limit";

export async function POST(request, { params }) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in to vote." }, { status: 401 });

  try {
    await checkRateLimit(accountId, "vote");
  } catch (e) {
    if (e instanceof RateLimitError) {
      return NextResponse.json({ error: e.message }, { status: 429, headers: { "Retry-After": String(Math.ceil(e.retryAfterMs / 1000)) } });
    }
    throw e;
  }

  const { id } = await params;
  const anonKey = (await getOrCreateAlias(accountId)).anonymousId;
  const updated = await voteCringe(id, anonKey);
  if (!updated) return NextResponse.json({ error: "Post not found or not nominated for Cringe Awards." }, { status: 404 });

  const topAnonymousId = await getTopCringePostAnonymousId();
  if (topAnonymousId) {
    await checkAndAwardBadgesForAnonymousId(topAnonymousId, { wonCringeAwards: true });
  }

  return NextResponse.json(updated);
}
