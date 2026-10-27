import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { getOrCreateAlias } from "@/lib/identity/service";
import { getRoomById, updateRoomSettings, deleteRoom } from "@/lib/content/service";
import { closeLiveKitRoom } from "@/lib/livekit";

function fail(e) {
  const map = { NOT_HOST: 403, NOT_FOUND: 404, ROOM_ENDED: 410, NOT_ENDED: 409, CANNOT_DEMOTE_HOST: 400, CANNOT_REMOVE_HOST: 400, BANNED: 403, LOCKED: 423 };
  if (map[e.code]) return NextResponse.json({ error: e.message, code: e.code }, { status: map[e.code] });
  console.error("[rooms]", e);
  return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
}

export async function GET(request, { params }) {
  const { id } = await params;
  const accountId = await getCurrentAccountId();
  const viewerKey = accountId ? (await getOrCreateAlias(accountId)).anonymousId : null;
  const room = await getRoomById(id, viewerKey);
  if (!room || (room.ended && !room.isHost)) return NextResponse.json({ error: "Room not found." }, { status: 404 });
  return NextResponse.json(room);
}

export async function PATCH(request, { params }) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const me = await getOrCreateAlias(accountId);
  try {
    return NextResponse.json(await updateRoomSettings(id, me.anonymousId, { topic: body.topic, vibe: body.vibe, locked: body.locked }));
  } catch (e) { return fail(e); }
}

// Host-only, and only after the session has been ended.
export async function DELETE(request, { params }) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });
  const { id } = await params;
  const me = await getOrCreateAlias(accountId);
  try {
    const result = await deleteRoom(id, me.anonymousId);
    await closeLiveKitRoom(id);
    return NextResponse.json(result);
  } catch (e) { return fail(e); }
}
