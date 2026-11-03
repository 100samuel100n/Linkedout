// Web Push for the installed web app (iPhone 16.4+ home-screen app, Android Chrome/Edge/Firefox/Samsung, desktop).
// Subscriptions are stored in the SAME push_tokens table as native tokens, as  "web:" + base64url(JSON), platform = "web".
// That means every existing path (notifications, announcements, test sends, audience counts, per-category preferences, sound on/off)
// reaches web users with no other change, and admins see them in the same "Push" counts, split by platform.
//
// Setup: node scripts/vapid-keygen.mjs  ->  set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@domain). `npm install` adds web-push.
import crypto from "node:crypto";

export const WEB_PREFIX = "web:";
export const isWebToken = (t) => typeof t === "string" && t.startsWith(WEB_PREFIX);
export const vapidConfigured = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY || "";

// Only real browser push services are allowed. Without this a logged-in user could register any URL and make the server POST to it (SSRF).
const HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
export function validateSubscription(sub) {
  const bad = (m) => Object.assign(new Error(m), { status: 400 });
  let u; try { u = new URL(String(sub?.endpoint || "")); } catch { throw bad("Invalid subscription."); }
  if (u.protocol !== "https:" || u.port || !HOSTS.some((r) => r.test(u.hostname))) throw bad("Unsupported push service.");
  const p256dh = String(sub?.keys?.p256dh || ""), auth = String(sub?.keys?.auth || "");
  if (!/^[A-Za-z0-9_-]{60,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,40}$/.test(auth)) throw bad("Invalid subscription keys.");
  if (u.toString().length > 700) throw bad("Subscription too large.");
  return { endpoint: u.toString(), keys: { p256dh, auth } };
}
export const encodeToken = (sub) => WEB_PREFIX + Buffer.from(JSON.stringify({ endpoint: sub.endpoint, keys: sub.keys })).toString("base64url");
export function decodeToken(token) { try { return validateSubscription(JSON.parse(Buffer.from(token.slice(WEB_PREFIX.length), "base64url").toString("utf8"))); } catch { return null; } }
export const tokenForEndpoint = (endpoint, keys) => encodeToken({ endpoint, keys });

let lib;
async function wp() {
  if (lib) return lib;
  try {
    const m = (await import("web-push")).default;
    m.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:net.linkedout@gmail.com", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    lib = m;
  } catch (e) { console.error("[webpush] web-push is not available:", e.message); lib = null; }
  return lib;
}

// Same contract as sendPushToTokens: returns { invalidTokens, sent, failed }. Dead subscriptions (404/410) are reported for pruning.
export async function sendWebPush(tokens, { title, body, data = {}, category, sound = null }) {
  const out = { invalidTokens: [], sent: 0, failed: 0 };
  if (!tokens.length) return out;
  if (!vapidConfigured()) { out.failed = tokens.length; out.errors = { WEBPUSH_NOT_CONFIGURED: { n: tokens.length, sample: "" } }; return out; }
  const push = await wp(); if (!push) { out.failed = tokens.length; return out; }
  const url = data.url || (data.relatedPostId ? `/post/${data.relatedPostId}` : "/notifications");
  const payload = JSON.stringify({ title: String(title || "LinkedOut").slice(0, 120), body: String(body || "").slice(0, 300), url: String(url).startsWith("/") || /^https:\/\//.test(url) ? url : "/notifications", tag: String(category || data.type || "lo").slice(0, 40), silent: !!(sound && !sound.enabled) });
  await Promise.all(tokens.map(async (t) => {
    const sub = decodeToken(t); if (!sub) { out.invalidTokens.push(t); out.failed++; return; }
    try { await push.sendNotification(sub, payload, { TTL: 86400, urgency: "high" }); out.sent++; }
    catch (e) { out.failed++; if (e?.statusCode === 404 || e?.statusCode === 410) out.invalidTokens.push(t); else console.error("[webpush] send failed:", e?.statusCode || e?.message); }
  }));
  return out;
}
export { crypto };