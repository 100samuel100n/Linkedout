import { NextResponse } from "next/server";
import { getRoomById, getMyRoomRole, touchParticipant } from "@/lib/content/service";
import { getCurrentAccountId } from "@/lib/session";
import { getOrCreateAlias } from "@/lib/identity/service";
import { isLiveKitConfigured, createRoomToken } from "@/lib/livekit";

// Issues real WebRTC audio credentials for a vent room. Deliberately
// requires the caller to already be a joined participant (POST
// /api/rooms/[id]/join first) — you shouldn't get a mic token for a
// room you haven't entered.
//
// When LIVEKIT_* env vars aren't set, this returns { configured: false }
// rather than an error. Every caller of this route treats that as
// "stay in the existing listen-only/waiting-room UI" — never as a
// failure to surface to the user.
export async function GET(request, { params }) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });

  const { id } = await params;
  const room = await getRoomById(id);
  if (!room) return NextResponse.json({ error: "Room not found." }, { status: 404 });

  if (room.ended) return NextResponse.json({ error: "The host has ended this session.", code: "ROOM_ENDED" }, { status: 410 });

  if (!isLiveKitConfigured()) {
    return NextResponse.json({ configured: false });
  }

  const identity = await getOrCreateAlias(accountId);
  const myRole = await getMyRoomRole(id, identity.anonymousId);
  if (!myRole) return NextResponse.json({ error: "Join the room first.", code: "NOT_JOINED" }, { status: 403 });
  await touchParticipant(id, identity.anonymousId);
  const token = await createRoomToken({
    roomName: id,
    identity: identity.anonymousId,
    displayName: identity.displayLabel,
    // Only the host and promoted speakers can open a mic; everyone else is
    // listen-only. Later role changes are applied on the LiveKit server
    // itself (lib/livekit.js), so no reconnect or second token is needed.
    canPublish: myRole?.role === "host" || myRole?.role === "speaker",
  });

  if (!token) return NextResponse.json({ configured: false });
  return NextResponse.json({ configured: true, role: myRole?.role || "listener", ...token });
}
