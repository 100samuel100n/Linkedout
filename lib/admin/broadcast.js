// Push + email broadcasts: create / schedule / test / cancel / run.
// Sending is claimed atomically in the database (status scheduled → sending), so even with
// several server instances or a retried cron call a broadcast can never go out twice.
import crypto from "node:crypto";
import { identityDb } from "@/lib/identity/db";
import { normalizeSoundPrefs } from "@/lib/sound-tones";
import { sendPushToTokens, isPushConfigured } from "@/lib/push";
import { getAppUrl } from "@/lib/config";
import { senderFor } from "@/lib/email-senders";
import { renderBroadcastEmail, renderPlain, buildMessage, sendBatch, sendOne, isResendConfigured, BATCH_PAUSE_MS } from "@/lib/email-broadcast";
import { previewAudience, resolveRecipients, normalizeAudience, describeAudience } from "./audience";
import { logStaff } from "./enforce";
import { keyFromPublicUrl } from "@/lib/storage";

// ---- audio / voice / music attachments on push broadcasts ----
// A push payload is capped at ~4 KB, so the audio itself never rides in the push. The push carries a small
// `media` descriptor ({url, title, kind, bytes, dur}); the app downloads the file in the background (see the
// native lib/audioInbox.js), shows download progress, and plays it from the notification inbox.
let mediaCols = false;
async function ensureMediaCols() {
  if (mediaCols) return;
  await identityDb.prepare("ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS media TEXT").run();
  await identityDb.prepare("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS media TEXT").run();
  mediaCols = true;
}
export const MEDIA_KINDS = ["voice", "audio", "song"];
function cleanMedia(m) {
  if (!m) return null;
  const url = String(m.url || "");
  if (!/^https:\/\//.test(url) || !keyFromPublicUrl(url)) throw bad("Upload the audio file with the Attach audio button first.");
  return {
    url, kind: MEDIA_KINDS.includes(m.kind) ? m.kind : "audio",
    title: String(m.title || "").trim().slice(0, 80), artist: String(m.artist || "").trim().slice(0, 80),
    bytes: Math.max(0, Math.round(Number(m.bytes) || 0)), dur: Math.max(0, Math.round(Number(m.dur) || 0)), mime: String(m.mime || "audio/mpeg").slice(0, 60),
  };
}

const iso = (ms = 0) => new Date(Date.now() + ms).toISOString();
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

// ---------------- status panels ----------------
export async function channelStatus(channel) {
  if (channel === "push") {
    const [tok, byPlat, reach] = await Promise.all([
      identityDb.prepare("SELECT COUNT(*) AS n FROM push_tokens").get(),
      identityDb.prepare("SELECT COALESCE(platform,'unknown') p, COUNT(*) n FROM push_tokens GROUP BY platform").all(),
      identityDb.prepare("SELECT COUNT(DISTINCT account_id) AS n FROM push_tokens").get(),
    ]);
    return { items: [
      ["Expo push service", isPushConfigured() ? "enabled" : "disabled (DISABLE_PUSH=1)", isPushConfigured()],
      ["EXPO_ACCESS_TOKEN", process.env.EXPO_ACCESS_TOKEN ? "set (enhanced security)" : "not set — works, but unauthenticated", !!process.env.EXPO_ACCESS_TOKEN],
      ["Registered devices", `${Number(tok.n).toLocaleString()} on ${Number(reach.n).toLocaleString()} accounts`, Number(tok.n) > 0],
      ["Platforms", byPlat.map((r) => `${r.p}: ${r.n}`).join(" · ") || "none yet", byPlat.length > 0],
    ] };
  }
  return { items: [
    ["Resend API key", process.env.RESEND_API_KEY ? "set" : "missing — add RESEND_API_KEY", !!process.env.RESEND_API_KEY],
    ["Sender (announcements)", (process.env.RESEND_FROM_EMAIL || process.env.EMAIL_DOMAIN) ? senderFor("news").from : "missing: add EMAIL_DOMAIN (or RESEND_FROM_EMAIL)", !!(process.env.RESEND_FROM_EMAIL || process.env.EMAIL_DOMAIN)],
    ["Reply-to", process.env.RESEND_REPLY_TO || "not set (optional)", !!process.env.RESEND_REPLY_TO],
    ["Postal address in footer", process.env.EMAIL_FOOTER_ADDRESS ? "set" : "not set — recommended (CAN-SPAM / GDPR)", !!process.env.EMAIL_FOOTER_ADDRESS],
    ["Links point to", getAppUrl(), !/localhost/.test(getAppUrl())],
  ] };
}

export async function listBroadcasts(channel) {
  await ensureMediaCols();
  const rows = await identityDb.prepare("SELECT b.*, a.pseudonym AS by FROM broadcasts b LEFT JOIN accounts a ON a.id = b.created_by WHERE b.channel = ? ORDER BY b.created_at DESC LIMIT 60").all(channel);
  return rows.map((b) => ({ id: b.id, name: b.name, title: b.subject || b.title, kind: b.kind, status: b.status, audience: describeAudience(JSON.parse(b.audience)), scheduledAt: b.scheduled_at, createdAt: b.created_at, by: b.by, total: b.total, sent: b.sent, failed: b.failed, skipped: b.skipped, error: b.error, finishedAt: b.finished_at, raw: { name: b.name, subject: b.subject, title: b.title, body: b.body, ctaLabel: b.cta_label, ctaUrl: b.cta_url, audience: JSON.parse(b.audience), kind: b.kind, inApp: !!b.in_app, media: b.media ? JSON.parse(b.media) : null }, media: b.media ? JSON.parse(b.media) : null }));
}

// ---------------- validation ----------------
function clean(channel, p) {
  const t = (v, n) => String(v ?? "").trim().slice(0, n);
  const out = { name: t(p.name, 80), subject: t(p.subject, 150), title: t(p.title, channel === "push" ? 65 : 120), body: t(p.body, channel === "push" ? 178 : 20000), ctaLabel: t(p.ctaLabel, 40), ctaUrl: t(p.ctaUrl, 500), kind: p.kind === "service" ? "service" : "marketing", inApp: p.inApp !== false, preheader: t(p.preheader, 140), audience: normalizeAudience(p.audience), media: channel === "push" ? cleanMedia(p.media) : null };
  if (channel === "push") { if (!out.title) throw bad("Add a title."); if (!out.body) throw bad("Add a message."); }
  else { if (!out.subject) throw bad("Add a subject line."); if (!out.body) throw bad("Write the email body."); }
  if (out.ctaUrl && !/^(https?:\/\/|\/)/.test(out.ctaUrl)) throw bad("The link must start with https:// (or / for a page in the app).");
  if (out.ctaLabel && !out.ctaUrl) throw bad("A button label needs a link.");
  if (out.audience.mode === "individuals" && !out.audience.people.trim()) throw bad("List at least one person.");
  return out;
}

export function reach(channel, audience, kind) { return previewAudience(channel, audience, kind); }
export function renderPreview(p) {
  const e = clean("email", { ...p, subject: p.subject || "Preview", body: p.body || "Your message appears here." });
  const vars = { firstName: "Maya", handle: "maya_okafor" };
  return renderBroadcastEmail({ headline: e.title, body: e.body, ctaLabel: e.ctaLabel, ctaUrl: e.ctaUrl, preheader: e.preheader, kind: e.kind, unsubUrl: "#", vars });
}

// ---------------- create / schedule / cancel ----------------
export async function createBroadcast(staff, channel, p) {
  await ensureMediaCols();
  const c = clean(channel, p);
  const r = await previewAudience(channel, c.audience, c.kind);
  if (r.reachable === 0) throw bad("Nobody in this audience can receive it (no matching accounts with " + (channel === "push" ? "a registered device" : "a verified email") + ", or they all opted out).");
  if (channel === "email" && !isResendConfigured()) throw bad("Email isn't configured: set RESEND_API_KEY and EMAIL_DOMAIN (or RESEND_FROM_EMAIL) on the server.");
  let when = iso(), status = "scheduled";
  if (p.scheduleAt) { const d = new Date(p.scheduleAt); if (isNaN(d)) throw bad("That schedule time isn't valid."); if (d.getTime() > Date.now() + 60000) when = d.toISOString(); }
  if (c.kind === "service" && staff.role !== "super_admin" && staff.role !== "admin") throw bad("Only admins can send service notices.", 403);
  const id = crypto.randomUUID();
  await identityDb.prepare("INSERT INTO broadcasts (id, channel, name, subject, title, body, cta_label, cta_url, audience, kind, in_app, status, scheduled_at, created_by, created_at, total, media) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, channel, c.name || (channel === "push" ? c.title : c.subject), channel === "email" ? c.subject : null, c.title, c.body, c.ctaLabel || null, c.ctaUrl || null, JSON.stringify(c.audience), c.kind, c.inApp ? 1 : 0, status, when, staff.id, iso(), r.reachable, c.media ? JSON.stringify(c.media) : null);
  await logStaff(staff, `broadcast:${channel}:create`, id, `${describeAudience(c.audience)} · ${r.reachable} reachable · ${when > iso(5000) ? "scheduled " + when : "now"}`);
  return { id, reachable: r.reachable, scheduledAt: when, immediate: when <= iso(5000) };
}
export async function cancelBroadcast(staff, id) {
  const r = await identityDb.prepare("UPDATE broadcasts SET status = 'cancelled', finished_at = ? WHERE id = ? AND status = 'scheduled'").run(iso(), id);
  if (!r.changes) throw bad("Only scheduled broadcasts can be cancelled.");
  await logStaff(staff, "broadcast:cancel", id);
}

// ---------------- test sends (to the staff member only) ----------------
export async function sendTest(staff, channel, p, to) {
  const c = clean(channel, p);
  const me = await identityDb.prepare("SELECT id, email, pseudonym, real_name FROM accounts WHERE id = ?").get(staff.id);
  if (channel === "email") {
    const address = (to || me.email || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address)) throw bad("Enter a valid email address for the test.");
    const vars = { firstName: (me.real_name || me.pseudonym || "").split(/\s+/)[0] || "there", handle: me.pseudonym };
    const args = { headline: c.title, body: c.body, ctaLabel: c.ctaLabel, ctaUrl: c.ctaUrl, preheader: c.preheader, kind: c.kind, unsubUrl: "#", vars, isTest: true };
    const r = await sendOne({ from: (await import("@/lib/email-senders")).senderFor(c.kind === "service" ? "service" : "news").from, to: [address], subject: "[TEST] " + c.subject, html: renderBroadcastEmail(args), text: renderPlain(args) });
    if (!r.ok) throw bad(r.error || "Couldn't send the test email.");
    await logStaff(staff, "broadcast:email:test", null, address);
    return { sentTo: address };
  }
  const tokens = (await identityDb.prepare("SELECT token FROM push_tokens WHERE account_id = ?").all(staff.id)).map((t) => t.token);
  if (!tokens.length) throw bad("None of your devices is registered for push. Open the native app on a development/production build, log in, and allow notifications.");
  const r = await sendPushToTokens(tokens, { title: "[TEST] " + c.title, body: c.body, data: { type: "announcement", url: c.ctaUrl || null, ...(c.media ? { media: c.media } : {}) }, category: "announcements", wake: !!c.media });
  if (r.sent === 0) throw bad("Expo accepted no messages. Check EXPO_ACCESS_TOKEN and your Firebase/APNs credentials in EAS.");
  await logStaff(staff, "broadcast:push:test", null, `${r.sent} device(s)`);
  return { devices: r.sent };
}

// ---------------- the runner ----------------
async function setCounts(id, n) { await identityDb.prepare("UPDATE broadcasts SET sent = ?, failed = ?, skipped = ?, total = ? WHERE id = ?").run(n.sent, n.failed, n.skipped, n.total, id); }

async function runPush(b) {
  const rcpts = await resolveRecipients("push", JSON.parse(b.audience), b.kind);
  const n = { sent: 0, failed: 0, skipped: 0, total: rcpts.length };
  for (const part of chunks(rcpts, 400)) {
    const ids = part.map((r) => r.id);
    const [toks, sounds, inAppOff] = await Promise.all([
      identityDb.prepare("SELECT account_id, token FROM push_tokens WHERE account_id = ANY(?)").all(ids),
      identityDb.prepare("SELECT id, sound_prefs FROM accounts WHERE id = ANY(?)").all(ids),
      b.kind === "service" ? [] : identityDb.prepare("SELECT account_id FROM notification_preferences WHERE category = 'announcements' AND in_app = 0 AND account_id = ANY(?)").all(ids),
    ]);
    // Honour each person's sound / vibrate / tone by grouping identical settings into one send.
    const prefs = new Map(sounds.map((s) => { let p = null; try { p = s.sound_prefs ? JSON.parse(s.sound_prefs) : null; } catch {} return [s.id, normalizeSoundPrefs(p)]; }));
    const groups = new Map();
    for (const t of toks) { const s = prefs.get(t.account_id) || normalizeSoundPrefs(null); const k = `${s.enabled}|${s.tone}|${s.vibrate}`; (groups.get(k) || groups.set(k, { s, tokens: [] }).get(k)).tokens.push(t.token); }
    for (const g of groups.values()) {
      const r = await sendPushToTokens(g.tokens, { title: b.title, body: b.body, data: { type: "announcement", url: b.cta_url || null, broadcastId: b.id, ...(b.media ? { media: JSON.parse(b.media) } : {}) }, category: "announcements", sound: g.s, toneId: g.s.tone, wake: !!b.media });
      n.sent += r.sent; n.failed += r.failed;
      if (r.invalidTokens.length) await identityDb.prepare("DELETE FROM push_tokens WHERE token = ANY(?)").run(r.invalidTokens);
    }
    if (b.in_app) {
      const skip = new Set(inAppOff.map((x) => x.account_id));
      const ins = identityDb.prepare("INSERT INTO notifications (id, account_id, type, message, related_post_id, created_at, media) VALUES (?, ?, 'announcement', ?, NULL, ?, ?)");
      for (const r of part) if (!skip.has(r.id)) await ins.run(crypto.randomUUID(), r.id, `${b.title} — ${b.body}`.slice(0, 400), iso(), b.media || null);
    }
    await setCounts(b.id, n);
  }
  return n;
}

async function runEmail(b) {
  const rcpts = await resolveRecipients("email", JSON.parse(b.audience), b.kind);
  const n = { sent: 0, failed: 0, skipped: 0, total: rcpts.length };
  let lastError = null;
  for (const part of chunks(rcpts, 100)) {
    const r = await sendBatch(part.map((rc) => buildMessage(rc, { subject: b.subject, title: b.title, body: b.body, cta_label: b.cta_label, cta_url: b.cta_url, kind: b.kind })));
    n.sent += r.sent; n.failed += r.failed; if (r.error) lastError = r.error;
    await setCounts(b.id, n);
    await wait(BATCH_PAUSE_MS);
  }
  return { ...n, error: lastError };
}

export async function runBroadcast(id) {
  const claimed = await identityDb.prepare("UPDATE broadcasts SET status = 'sending', started_at = ? WHERE id = ? AND status = 'scheduled'").run(iso(), id);
  if (!claimed.changes) return null;
  const b = await identityDb.prepare("SELECT * FROM broadcasts WHERE id = ?").get(id);
  try {
    const n = b.channel === "push" ? await runPush(b) : await runEmail(b);
    await identityDb.prepare("UPDATE broadcasts SET status = ?, finished_at = ?, error = ? WHERE id = ?").run(n.sent === 0 && n.total > 0 ? "failed" : "sent", iso(), n.error || (n.sent === 0 && n.total > 0 ? "Nothing was delivered. Check credentials in the status panel." : null), id);
    return n;
  } catch (e) {
    console.error("[broadcast] failed:", e);
    await identityDb.prepare("UPDATE broadcasts SET status = 'failed', finished_at = ?, error = ? WHERE id = ?").run(iso(), "Unexpected error while sending — see server logs.", id);
    return null;
  }
}

// Picks up everything that's due. Called every minute by instrumentation.js, by the
// protected /api/cron/broadcasts endpoint, and right after a "send now".
let running = false;
export async function processDueBroadcasts() {
  if (running) return; running = true;
  try {
    await identityDb.prepare("UPDATE broadcasts SET status = 'failed', finished_at = ?, error = 'Interrupted (server restarted mid-send). Some recipients may have received it — it was NOT retried automatically.' WHERE status = 'sending' AND started_at < ?").run(iso(), iso(-45 * 60000));
    const due = await identityDb.prepare("SELECT id FROM broadcasts WHERE status = 'scheduled' AND scheduled_at <= ? ORDER BY scheduled_at LIMIT 5").all(iso());
    for (const d of due) await runBroadcast(d.id);
  } finally { running = false; }
}
