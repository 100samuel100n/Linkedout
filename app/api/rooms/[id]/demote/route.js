import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { getOrCreateAlias } from "@/lib/identity/service";
import { demoteToListener } from "@/lib/content/service";
import { setParticipantCanPublish } from "@/lib/livekit";
import { checkRateLimit, RateLimitError } from "@/lib/identity/rate-limit";

function fail(e) {
  const map = { NOT_HOST: 403, NOT_FOUND: 404, ROOM_ENDED: 410, NOT_ENDED: 409, CANNOT_DEMOTE_HOST: 400, CANNOT_REMOVE_HOST: 400, BANNED: 403, LOCKED: 423 };
  if (map[e.code]) return NextResponse.json({ error: e.message, code: e.code }, { status: map[e.code] });
  console.error("[rooms]", e);
  return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
}

export async function POST(request, { params }) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });
  try { await checkRateLimit(accountId, "room_action"); } catch (e) { if (e instanceof RateLimitError) return NextResponse.json({ error: e.message }, { status: 429 }); throw e; }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body?.handle) return NextResponse.json({ error: "handle is required." }, { status: 400 });

  const me = await getOrCreateAlias(accountId);
  try {
    const participants = await demoteToListener(id, me.anonymousId, body.handle);
    // Hard mute: the media server drops their publish permission.
    await setParticipantCanPublish(id, body.handle, false);
    return NextResponse.json({ participants });
  } catch (e) { return fail(e); }
}
