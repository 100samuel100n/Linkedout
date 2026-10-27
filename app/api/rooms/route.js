import { effectiveTier } from "@/lib/tiers";
import { NextResponse } from "next/server";
import { restrictionError } from "@/lib/admin/enforce";
import { getRooms, createRoom } from "@/lib/content/service";
import { getCurrentAccountId } from "@/lib/session";
import { getAccountById, issueContentToken, verifyContentToken, getOrCreateAlias } from "@/lib/identity/service";
import { checkRateLimit, RateLimitError } from "@/lib/identity/rate-limit";
import { canCreateVent } from "@/lib/tiers";
import { contentDb } from "@/lib/content/db";
import { managerCircleId } from "@/lib/stories/circles";

const VALID_MODES = new Set(["real", "alias", "anon"]);

export async function GET() {
  const accountId = await getCurrentAccountId();
  const viewerKey = accountId ? (await getOrCreateAlias(accountId)).anonymousId : null;
  return NextResponse.json(await getRooms(viewerKey));
}

export async function POST(request) {
  const accountId = await getCurrentAccountId();
  { const blocked = accountId && await restrictionError(accountId, "vent_rooms"); if (blocked) return blocked; }
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });

  const account = await getAccountById(accountId);
  if (!canCreateVent(effectiveTier(account))) {
    return NextResponse.json({ error: "Starting a Vent Room needs a Pro plan.", code: "TIER_RESTRICTED" }, { status: 403 });
  }

  try {
    await checkRateLimit(accountId, "room_create");
  } catch (e) {
    if (e instanceof RateLimitError) {
      return NextResponse.json({ error: e.message }, { status: 429, headers: { "Retry-After": String(Math.ceil(e.retryAfterMs / 1000)) } });
    }
    throw e;
  }

  const body = await request.json().catch(() => null);
  const topic = body?.topic?.trim();
  if (!topic) return NextResponse.json({ error: "Room topic is required." }, { status: 400 });
  const mode = VALID_MODES.has(body?.mode) ? body.mode : "alias";

  // A room's host is always identified by the account's stable alias id,
  // whatever display mode the room is shown under — that's what keeps the
  // host recognised (and in control) every time they come back.
  const alias = await getOrCreateAlias(accountId);
  const { token } = await issueContentToken(accountId, mode);
  const shown = await verifyContentToken(token);
  const identity = { anonymousId: alias.anonymousId, displayLabel: shown.displayLabel };

  const room = await createRoom({
    topic, vibe: body?.vibe?.trim() || "Vent",
    startsAt: body?.startsAt ? new Date(body.startsAt).toISOString() : null,
    anonymousId: identity.anonymousId, authorDisplay: identity.displayLabel,
  });
  // A Story Room: a live room tied to a story (its author hosts) or to a circle (owner/mods host).
  // Only linked when the host genuinely owns/manages the thing, so nobody can attach rooms to others' stories.
  let storyId = null, circleId = null;
  if (body?.storyId) {
    const s = await contentDb.prepare("SELECT id FROM stories WHERE id = ? AND anonymous_id = ? AND status = 'published'").get(body.storyId, alias.anonymousId);
    if (s) storyId = s.id;
  }
  if (body?.circleSlug) circleId = await managerCircleId(body.circleSlug, alias.anonymousId);
  if (storyId || circleId) await contentDb.prepare("UPDATE rooms SET story_id = ?, circle_id = ?, vibe = 'Story' WHERE id = ?").run(storyId, circleId, room.id);
  return NextResponse.json({ ...room, vibe: storyId || circleId ? "Story" : room.vibe, storyId, circleId }, { status: 201 });
}
