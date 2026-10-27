// Push delivery via Expo's push notification service
// (https://exp.host/--/api/v2/push/send) — a plain public REST endpoint,
// so this talks to it directly with fetch rather than pulling in
// expo-server-sdk for what's a two-field JSON POST. Every push includes
// the recipient's chosen tone (bundled in the app as `tone-<id>.wav`).
//
// Setup: nothing required for basic sending — Expo's push service works
// out of the box for any app using expo-notifications, no API key
// needed. Set EXPO_ACCESS_TOKEN (from your Expo account, for "Enhanced
// Security" push notifications: https://docs.expo.dev/push-notifications/sending-notifications/#security)
// if you want Expo to reject push requests that don't present your
// token — optional, and this file works identically either way.
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const MAX_BATCH = 100; // Expo's own per-request limit

export function isPushConfigured() {
  // Always "configured" — Expo push works without any account-level
  // setup. This exists for symmetry with the rest of the codebase's
  // isXConfigured() pattern and as a single place to gate push off
  // entirely (e.g. in a test environment) if ever needed.
  return process.env.DISABLE_PUSH !== "1";
}

async function sendBatch(messages) {
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  const res = await fetch(EXPO_PUSH_URL, { method: "POST", headers, body: JSON.stringify(messages) });
  if (!res.ok) {
    console.error("[push] Expo push API error:", res.status, await res.text().catch(() => ""));
    return [];
  }
  const data = await res.json();
  return data.data || [];
}

// tokens: array of Expo push token strings. Returns the list of tokens
// Expo reported as permanently invalid (DeviceNotRegistered) — callers
// should prune those from push_tokens so we stop retrying dead devices.
// `sound` = the recipient's saved sound preferences; `toneId` = which tone
// to use. Each tone has its own Android channel (a channel's sound is fixed
// once created, so the choice is made by picking the channel) and its own
// bundled file for iOS. A recipient who has sounds off gets a silent push.
export async function sendPushToTokens(tokens, { title, body, data, category, sound = null, toneId = "signal", wake = false }) {
  if (!isPushConfigured() || tokens.length === 0) return { invalidTokens: [], sent: 0, failed: 0 };

  const audible = !sound || sound.enabled;
  const messages = tokens.map((to) => ({
    to, title, body, priority: "high",
    sound: audible ? `tone-${toneId}.wav` : null,
    channelId: audible ? `alerts_${toneId}${sound && !sound.vibrate ? "_nv" : ""}` : "alerts_silent",
    data: { ...data, category },
    // Audio pushes also wake the app in the background (iOS content-available, Android data message) so it can
    // start downloading the file before the person even opens the notification.
    ...(wake ? { _contentAvailable: true, mutableContent: true } : {}),
  }));

  const invalidTokens = [];
  let sent = 0, failed = 0;
  for (let i = 0; i < messages.length; i += MAX_BATCH) {
    const batch = messages.slice(i, i + MAX_BATCH);
    try {
      const results = await sendBatch(batch);
      if (results.length === 0) failed += batch.length;
      results.forEach((r, idx) => {
        if (r.status === "ok") sent++; else failed++;
        if (r.status === "error" && r.details?.error === "DeviceNotRegistered") {
          invalidTokens.push(batch[idx].to);
        }
      });
    } catch (e) {
      failed += batch.length;
      console.error("[push] send failed:", e.message);
    }
  }
  return { invalidTokens, sent, failed };
}
