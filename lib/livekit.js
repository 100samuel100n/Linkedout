// Real-time audio for Vent Rooms, via LiveKit (open-source WebRTC media
// server — self-hostable or LiveKit Cloud). Same lazy-client, graceful-
// fallback pattern as lib/stripe.js and lib/email.js: if the env vars
// below aren't set, isLiveKitConfigured() returns false and every
// caller (the /api/rooms/[id]/token route, the VentAudioRoom client
// component) falls back to the existing identity-only "waiting room"
// behavior instead of crashing or faking a connection.
//
// Setup (see README § Vent Room audio setup):
//   1. Either self-host LiveKit (https://docs.livekit.io/home/self-hosting/)
//      or create a free LiveKit Cloud project (https://cloud.livekit.io).
//   2. `livekit-server-sdk` and `livekit-client` are dependencies in
//      package.json (imported lazily here so builds never need them).
//   3. Set LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL (server) and
//      NEXT_PUBLIC_LIVEKIT_URL (same value, exposed to the browser) in
//      .env.local.

let _sdk = null;

async function getSdk() {
  if (_sdk) return _sdk;
  try {
    _sdk = await import("livekit-server-sdk");
    return _sdk;
  } catch {
    // Package not installed — treated exactly like a missing API key:
    // isLiveKitConfigured() below is what callers should check first,
    // this is just the second line of defense.
    return null;
  }
}

export function isLiveKitConfigured() {
  return Boolean(process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET && process.env.LIVEKIT_URL);
}

// identity: the room's own anonymous_id for this account (never the
// real account id or display name tied to their non-anon identity) —
// same anonymity guarantee the rest of the content layer holds to.
// displayName: what other participants see in the LiveKit room roster
// (their existing alias/anon display label — not their real name).
// ---- Server-enforced host controls -------------------------------------
// The token a client holds can't be revoked, but LiveKit's server API can
// change a connected participant's permissions, remove them, or close the
// whole room. These make host actions real (a muted speaker's audio is cut
// by the media server, not just by their own app cooperating). Every call
// is best-effort: if LiveKit is unreachable the database change still
// stands and the clients' own data-channel message acts as a backup.
async function getRoomService() {
  if (!isLiveKitConfigured()) return null;
  const sdk = await getSdk();
  if (!sdk?.RoomServiceClient) return null;
  const host = process.env.LIVEKIT_URL.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
  return new sdk.RoomServiceClient(host, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
}

async function safely(fn) {
  try { await fn(); return true; } catch (e) { console.error("[livekit]", e.message); return false; }
}

export async function setParticipantCanPublish(roomName, identity, canPublish) {
  const svc = await getRoomService();
  if (!svc) return false;
  return safely(() => svc.updateParticipant(roomName, identity, undefined, {
    canSubscribe: true, canPublish, canPublishData: true,
  }));
}

export async function removeLiveKitParticipant(roomName, identity) {
  const svc = await getRoomService();
  if (!svc) return false;
  return safely(() => svc.removeParticipant(roomName, identity));
}

// Disconnects everyone and discards the room on the media server.
export async function closeLiveKitRoom(roomName) {
  const svc = await getRoomService();
  if (!svc) return false;
  return safely(() => svc.deleteRoom(roomName));
}

export async function createRoomToken({ roomName, identity, displayName, canPublish = true }) {
  if (!isLiveKitConfigured()) return null;
  const sdk = await getSdk();
  if (!sdk) return null;

  const { AccessToken } = sdk;
  const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity,
    name: displayName,
    ttl: "4h",
  });
  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish,
    canSubscribe: true,
    // Listeners (canPublish: false) can still see who's talking and
    // react — they just can't open their mic, matching an X Spaces
    // "listener" role vs. "speaker" role.
    canPublishData: true,
  });
  return {
    jwt: await token.toJwt(),
    url: process.env.LIVEKIT_URL,
  };
}

