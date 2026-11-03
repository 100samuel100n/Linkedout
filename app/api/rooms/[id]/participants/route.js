import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { getOrCreateAlias } from "@/lib/identity/service";
import { getRoomParticipants, getRoomById, getMyRoomRole, touchParticipant } from "@/lib/content/service";

// Doubles as the presence heartbeat: a joined client polls this every few
// seconds, which keeps them counted as "in the room" and tells them at once
// if the host has ended the session or removed them.
export async function GET(request, { params }) {
  const { id } = await params;
  const accountId = await getCurrentAccountId();
  const viewerKey = accountId ? (await getOrCreateAlias(accountId)).anonymousId : null;
  if (viewerKey) await touchParticipant(id, viewerKey);
  const room = await getRoomById(id, viewerKey);
  if (!room) return NextResponse.json({ error: "Room not found." }, { status: 404 });
  const me = viewerKey ? await getMyRoomRole(id, viewerKey) : null;
  return NextResponse.json({
    participants: room.ended ? [] : await getRoomParticipants(id),
    status: room.status,
    locked: room.locked,
    topic: room.topic,
    myRole: me?.role || null,
    removed: !!viewerKey && !room.ended && !me,
  });
}
