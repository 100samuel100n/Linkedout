import { effectiveTier } from "@/lib/tiers";
import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { getOrCreateAlias } from "@/lib/identity/service";
import { joinRoom } from "@/lib/content/service";
import { getAccountById } from "@/lib/identity/service";
import { canJoinVent } from "@/lib/tiers";

function fail(e) {
  const map = { NOT_HOST: 403, NOT_FOUND: 404, ROOM_ENDED: 410, NOT_ENDED: 409, CANNOT_DEMOTE_HOST: 400, CANNOT_REMOVE_HOST: 400, BANNED: 403, LOCKED: 423 };
  if (map[e.code]) return NextResponse.json({ error: e.message, code: e.code }, { status: map[e.code] });
  console.error("[rooms]", e);
  return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
}

export async function POST(request, { params }) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in to join." }, { status: 401 });

  const account = await getAccountById(accountId);
  if (!canJoinVent(effectiveTier(account))) {
    return NextResponse.json({ error: "Joining a Vent Room isn't available on your account right now.", code: "TIER_RESTRICTED" }, { status: 403 });
  }

  const { id } = await params;
  const anonKey = (await getOrCreateAlias(accountId)).anonymousId;
  try {
    const room = await joinRoom(id, anonKey);
    if (!room) return NextResponse.json({ error: "Room not found." }, { status: 404 });
    return NextResponse.json(room);
  } catch (e) { return fail(e); }
}
