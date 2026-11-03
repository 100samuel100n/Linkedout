import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { getOrCreateAlias } from "@/lib/identity/service";
import { muteAllSpeakers } from "@/lib/content/service";
import { setParticipantCanPublish } from "@/lib/livekit";

function fail(e) {
  const map = { NOT_HOST: 403, NOT_FOUND: 404, ROOM_ENDED: 410, NOT_ENDED: 409, CANNOT_DEMOTE_HOST: 400, CANNOT_REMOVE_HOST: 400, BANNED: 403, LOCKED: 423 };
  if (map[e.code]) return NextResponse.json({ error: e.message, code: e.code }, { status: map[e.code] });
  console.error("[rooms]", e);
  return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
}

export async function POST(request, { params }) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });
  const { id } = await params;
  const me = await getOrCreateAlias(accountId);
  try {
    const { mutedKeys, participants } = await muteAllSpeakers(id, me.anonymousId);
    await Promise.all(mutedKeys.map((k) => setParticipantCanPublish(id, k, false)));
    return NextResponse.json({ participants, muted: mutedKeys.length });
  } catch (e) { return fail(e); }
}
