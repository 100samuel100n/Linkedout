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
import { isWebToken, sendWebPush } from "./webpush.js";
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const MAX_BATCH = 100; // Expo's own per-request limit

export function isPushConfigured() {
  // Always "configured" — Expo push works without any account-level
  // setup. This exists for symmetry with the rest of the codebase's
  // isXConfigured() pattern and as a single place to gate push off
  // entirely (e.g. in a test environment) if ever needed.
  return process.env.DISABLE_PUSH !== "1";
}

// Returns { ok, status, tickets } — never swallows WHY it failed. (Before, any non-200 from Expo became an empty list and the admin only
// saw "Nothing was delivered", with no way to tell a missing FCM key from a bad access token.)
async function sendBatch(messages) {
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  let res;
  try { res = await fetch(EXPO_PUSH_URL, { method: "POST", headers, body: JSON.stringify(messages), signal: AbortSignal.timeout(20000) }); }
  catch (e) { return { ok: false, status: 0, text: e?.message || "network error", tickets: [] }; }
  if (!res.ok) { const text = await res.text().catch(() => ""); console.error("[push] Expo push API error:", res.status, text); return { ok: false, status: res.status, text: text.slice(0, 300), tickets: [] }; }
  const data = await res.json().catch(() => ({}));
  return { ok: true, status: 200, tickets: data.data || [], topErrors: data.errors || null };
}

// Plain-language reason for each error code Expo/FCM/APNs can report, so the admin panel says what to fix.
export const PUSH_ERROR_HELP = {
  InvalidCredentials: "Expo has no valid Google FCM (Android) or Apple APNs key for this app. Upload your FCM V1 service-account key from the SAME Firebase project as google-services.json (EAS → Credentials → Android → FCM V1), then send again.",
  MismatchSenderId: "The FCM key Expo holds belongs to a different Firebase project than this app's google-services.json. Upload the key from the matching project.",
  InvalidProviderToken: "Apple rejected the APNs key. Re-create it with `eas credentials`.",
  DeviceNotRegistered: "These devices no longer exist (app uninstalled or token expired). They were removed automatically.",
  MessageTooBig: "The message is too large (push is limited to about 4 KB including attached data).",
  MessageRateExceeded: "Sending too fast to one device. Expo throttled it; try again shortly.",
  EXPO_HTTP_401: "Expo refused the request: EXPO_ACCESS_TOKEN is wrong, or the project requires an access token and none is set.",
  EXPO_HTTP_403: "Expo refused the request (forbidden). Check EXPO_ACCESS_TOKEN belongs to the account that owns this project.",
  EXPO_HTTP_429: "Expo is rate limiting this server. Retry in a minute.",
  EXPO_NETWORK: "This server could not reach exp.host (network/DNS/firewall).",
  WEBPUSH_NOT_CONFIGURED: "Web push is not set up: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY missing on the server.",
  NO_TOKENS: "None of the recipients has a registered device (they have not allowed notifications, or are on Expo Go / an emulator).",
};
export const mergeErrors = (into, from) => { for (const [k, v] of Object.entries(from || {})) { const e = (into[k] ||= { n: 0, sample: "" }); e.n += v.n; e.sample ||= v.sample; } return into; };
export function describeErrors(errors) {
  const parts = Object.entries(errors || {}).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => `${k} ×${v.n}: ${PUSH_ERROR_HELP[k] || v.sample || "unknown error"}`);
  return parts.join(" ");
}
// Last problems seen by this server process, shown in Admin → Push → status.
export const recentPushProblems = [];
const note = (errors, via) => { for (const [k, v] of Object.entries(errors || {})) { recentPushProblems.unshift({ at: new Date().toISOString(), code: k, n: v.n, via, help: PUSH_ERROR_HELP[k] || v.sample || "" }); } recentPushProblems.length = Math.min(recentPushProblems.length, 30); };
export { note as notePushProblems };

// tokens: array of Expo push token strings. Returns the list of tokens
// Expo reported as permanently invalid (DeviceNotRegistered) — callers
// should prune those from push_tokens so we stop retrying dead devices.
// `sound` = the recipient's saved sound preferences; `toneId` = which tone
// to use. Each tone has its own Android channel (a channel's sound is fixed
// once created, so the choice is made by picking the channel) and its own
// bundled file for iOS. A recipient who has sounds off gets a silent push.
export async function sendPushToTokens(allTokens, opts) {
  if (!isPushConfigured() || allTokens.length === 0) return { invalidTokens: [], sent: 0, failed: 0, errors: allTokens.length === 0 ? { NO_TOKENS: { n: 0, sample: "" } } : {}, tickets: [] };
  // Web-app subscriptions ("web:" tokens, see lib/webpush.js) go through Web Push; everything else goes through Expo as before.
  const webTokens = allTokens.filter(isWebToken), expoTokens = allTokens.filter((t) => !isWebToken(t));
  const [a, b] = await Promise.all([sendExpo(expoTokens, opts), webTokens.length ? sendWebPush(webTokens, opts) : { invalidTokens: [], sent: 0, failed: 0 }]);
  const errors = mergeErrors(mergeErrors({}, a.errors), b.errors);
  if (Object.keys(errors).length) note(errors, "send");
  return { invalidTokens: [...a.invalidTokens, ...b.invalidTokens], sent: a.sent + b.sent, failed: a.failed + b.failed, errors, tickets: a.tickets || [] };
}

async function sendExpo(tokens, { title, body, data, category, sound = null, toneId = "signal", wake = false }) {
  if (tokens.length === 0) return { invalidTokens: [], sent: 0, failed: 0, errors: {}, tickets: [] };

  const audible = !sound || sound.enabled;
  // Sound files are bundled as tone_<id>.wav (underscore: Android resource names cannot contain a hyphen) and channels are v2 so devices
  // that created the old silent hyphen-named channels get fresh ones. A silent push uses the silent channel.
  const messages = tokens.map((to) => ({
    to, ...(title ? { title } : {}), ...(body ? { body } : {}), priority: "high", ttl: 86400,
    sound: !title ? null : audible ? `tone_${toneId}.wav` : null,
    channelId: audible ? `n2_${toneId}${sound && !sound.vibrate ? "_nv" : ""}` : "n2_silent",
    data: { ...data, category },
    // Audio / kill pushes also wake the app in the background (iOS content-available, Android data message).
    ...(wake ? { _contentAvailable: true, mutableContent: true } : {}),
  }));

  const invalidTokens = [], errors = {}, tickets = [];
  let sent = 0, failed = 0;
  const add = (code, sample) => { const e = (errors[code] ||= { n: 0, sample: "" }); e.n++; e.sample ||= String(sample || "").slice(0, 200); };
  for (let i = 0; i < messages.length; i += MAX_BATCH) {
    const batch = messages.slice(i, i + MAX_BATCH);
    const r = await sendBatch(batch);
    if (!r.ok) { failed += batch.length; batch.forEach(() => add(r.status ? `EXPO_HTTP_${r.status}` : "EXPO_NETWORK", r.text)); continue; }
    if (r.tickets.length !== batch.length) { failed += batch.length - r.tickets.length; add("EXPO_SHORT_REPLY", "Expo returned fewer results than messages sent."); }
    r.tickets.forEach((t, idx) => {
      if (t.status === "ok") { sent++; if (t.id) tickets.push({ id: t.id, token: batch[idx].to }); }
      else { failed++; add(t.details?.error || "UNKNOWN", t.message); if (t.details?.error === "DeviceNotRegistered") invalidTokens.push(batch[idx].to); }
    });
  }
  return { invalidTokens, sent, failed, errors, tickets };
}

// Expo's "ok" ticket only means Expo ACCEPTED the message. Whether Google/Apple took it shows up in the receipt a few minutes later.
// Returns { errors, invalidTokens, checked }.
export async function fetchReceipts(ids) {
  const out = { errors: {}, invalidTokens: [], checked: 0, delivered: 0, pending: 0, answered: [] };
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  for (let i = 0; i < ids.length; i += 300) {
    const part = ids.slice(i, i + 300);
    let res; try { res = await fetch("https://exp.host/--/api/v2/push/getReceipts", { method: "POST", headers, body: JSON.stringify({ ids: part.map((x) => x.id) }), signal: AbortSignal.timeout(20000) }); } catch { continue; }
    if (!res.ok) continue;
    const data = (await res.json().catch(() => ({}))).data || {};
    for (const x of part) {
      const r = data[x.id]; if (!r) { out.pending++; continue; }
      out.checked++; out.answered.push(x.id);
      if (r.status === "ok") { out.delivered++; continue; }
      const code = r.details?.error || "UNKNOWN"; const e = (out.errors[code] ||= { n: 0, sample: r.message || "" }); e.n++;
      if (code === "DeviceNotRegistered") out.invalidTokens.push(x.token);
    }
  }
  return out;
}
