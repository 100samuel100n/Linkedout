// Direct messaging. The rules, in order of importance:
//   1. PRIVACY: people are only ever identified by their alias; no real
//      names, emails or account ids appear in any message data or API output.
//   2. CONSENT: a first message is a *request* (one short text). Nothing else
//      can be sent until the recipient accepts. Declining is silent and
//      imposes a 30-day cool-down; blocking is permanent until undone.
//   3. CONTROL: recipients choose who may message them (everyone / people
//      they follow / nobody), and whether read receipts / typing are shared.
//   4. SECURITY: bodies are encrypted at rest (crypto.js), sends are
//      idempotent, rate-limited and length-capped, and abuse can be reported
//      with evidence for review.
import crypto from "node:crypto";
import { contentDb } from "../content/db.js";
import { isValidReaction } from "../content/service.js";
import {
  getAliasHandles, resolveAliasAccountId, createNotification, getDmPrefs, accountFollowsAlias,
} from "../identity/service.js";
import { encryptMessage, decryptMessage } from "./crypto.js";
import { messagingFor } from "../tiers.js";

export class DmError extends Error {
  constructor(code, message, status = 400, extra = {}) { super(message); this.code = code; this.status = status; this.extra = extra; }
}

export const DM_LIMITS = {
  maxLen: 4000, requestMaxLen: 300, editWindowMs: 15 * 60 * 1000, declineCooldownMs: 30 * 864e5,
  typingTtlMs: 6000, activeWindowMs: 20000, notifyEveryMs: 2 * 60 * 1000, previewLen: 90,
};
export const TTL_OPTIONS = [0, 86400, 604800]; // off, 24h, 7d
export const REPORT_REASONS = { spam: "Spam or scam", harassment: "Harassment or threats", sexual: "Unwanted sexual content", impersonation: "Impersonation", other: "Something else" };

const nowIso = () => new Date().toISOString();
const pairKey = (a, b) => [a, b].sort().join("|");
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

// ---------- rich messages (stickers, GIFs, voice notes, files) ----------
// A rich message is stored in the same encrypted body as a plain one, as "\u0001" + JSON {c: caption, a: attachment}.
// No schema change, still end-to-end encrypted at rest, and old clients simply see the caption text.
const ENV = "\u0001";
export const ATTACH_KINDS = ["voice", "file", "gif", "sticker"];
function packEnvelope(caption, a) { return ENV + JSON.stringify({ c: caption || "", a }); }
function unpackEnvelope(raw) {
  if (typeof raw !== "string" || raw[0] !== ENV) return { text: raw, attachment: null };
  try { const o = JSON.parse(raw.slice(1)); return { text: o.c || "", attachment: o.a || null }; } catch { return { text: "", attachment: null }; }
}
const attachLabel = (a) => (a?.type === "voice" ? "🎤 Voice note" : a?.type === "file" ? `📎 ${a.name || "File"}` : a?.type === "sticker" ? "Sticker" : a?.type === "gif" ? "GIF" : "");
const isHttps = (u) => typeof u === "string" && /^https:\/\/[^\s]{3,1000}$/.test(u);

// Enforces the plan. The same rules the upload route uses, so a hand-made request can't skip them.
export function validateAttachment(a, tier) {
  if (!a || !ATTACH_KINDS.includes(a.type)) throw new DmError("BAD_ATTACHMENT", "That attachment isn't supported.");
  const perks = messagingFor(tier);
  if (!isHttps(a.url)) throw new DmError("BAD_ATTACHMENT", "That attachment link isn't valid.");
  if (a.type === "voice") {
    if (!perks.voiceNotes) throw new DmError("PLAN_REQUIRED", "Voice notes are available on OUT+ and OUT PRO.", 403, { feature: "voiceNotes", requiredTier: "plus" });
    const dur = Math.round(Number(a.dur) || 0);
    if (perks.voiceNoteMaxSeconds && dur > perks.voiceNoteMaxSeconds + 2) throw new DmError("TOO_LONG", `Voice notes can be up to ${Math.floor(perks.voiceNoteMaxSeconds / 60)}:${String(perks.voiceNoteMaxSeconds % 60).padStart(2, "0")} on your plan.`);
    return { type: "voice", url: a.url, dur, mime: String(a.mime || "audio/mp4").slice(0, 60) };
  }
  if (a.type === "file") {
    if (!perks.fileSharing) throw new DmError("PLAN_REQUIRED", "File sharing is available on OUT+ and OUT PRO.", 403, { feature: "fileSharing", requiredTier: "plus" });
    const size = Math.max(0, Number(a.size) || 0);
    if (perks.fileMaxMB && size > perks.fileMaxMB * 1048576) throw new DmError("TOO_LARGE", `Files can be up to ${perks.fileMaxMB} MB on your plan.`);
    return { type: "file", url: a.url, name: String(a.name || "File").replace(/[\u0000-\u001F<>]/g, "").slice(0, 120), size, mime: String(a.mime || "").slice(0, 100) };
  }
  if (!perks.stickers) throw new DmError("PLAN_REQUIRED", "Stickers aren't available on your plan.", 403);
  return { type: a.type, url: a.url, w: Math.round(Number(a.w) || 0) || undefined, h: Math.round(Number(a.h) || 0) || undefined, title: String(a.title || "").slice(0, 80) };
}

function cleanText(input, max) {
  const t = String(input ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\r\n/g, "\n").trim();
  if (!t) throw new DmError("EMPTY", "Write a message first.");
  if (t.length > max) throw new DmError("TOO_LONG", `Messages can be up to ${max.toLocaleString()} characters.`);
  return t;
}

// ---------- access helpers ----------
async function loadConversation(id, me) {
  const c = await contentDb.prepare("SELECT * FROM dm_conversations WHERE id = ?").get(id);
  // Same answer for "doesn't exist" and "not yours": never confirm a conversation to an outsider.
  if (!c || (c.a_key !== me && c.b_key !== me)) throw new DmError("NOT_FOUND", "Conversation not found.", 404);
  return c;
}
const otherOf = (c, me) => (c.a_key === me ? c.b_key : c.a_key);

async function blockedEitherWay(a, b) {
  return Boolean(await contentDb.prepare(
    "SELECT 1 AS x FROM dm_blocks WHERE (blocker_key = ? AND blocked_key = ?) OR (blocker_key = ? AND blocked_key = ?)"
  ).get(a, b, b, a));
}

async function purgeExpired() {
  await contentDb.prepare("DELETE FROM dm_reactions WHERE message_id IN (SELECT id FROM dm_messages WHERE expires_at IS NOT NULL AND expires_at < ?)").run(nowIso());
  await contentDb.prepare("DELETE FROM dm_messages WHERE expires_at IS NOT NULL AND expires_at < ?").run(nowIso());
}

// ---------- requests ----------
export async function sendRequest({ me, myAccountId, targetKey, text, tier = "basic" }) {
  if (!targetKey || targetKey === me) throw new DmError("BAD_TARGET", "You can't message yourself.");
  const perks = messagingFor(tier);
  const body = cleanText(text, perks.requestMaxLen);

  const targetAccountId = await resolveAliasAccountId(targetKey);
  if (!targetAccountId) throw new DmError("NOT_FOUND", "That profile doesn't exist.", 404);
  // Block and privacy failures all read the same, so a blocked sender can't
  // tell "blocked" from "not accepting messages".
  const unavailable = () => new DmError("UNAVAILABLE", "You can't message this person.", 403);
  if (await blockedEitherWay(me, targetKey)) throw unavailable();
  const prefs = await getDmPrefs(targetAccountId);
  if (prefs.who === "nobody") throw unavailable();
  if (prefs.who === "following" && !(await accountFollowsAlias(targetAccountId, me))) throw unavailable();

  const key = pairKey(me, targetKey);
  let conv = await contentDb.prepare("SELECT * FROM dm_conversations WHERE pair_key = ?").get(key);
  const t = nowIso();

  // OUT can only start chats inside their network (they follow the person, or the
  // person follows them). OUT+ and OUT PRO can message people outside it.
  // An existing conversation is always "in network".
  if (!perks.outsideNetwork && !conv) {
    const inNetwork = (await accountFollowsAlias(myAccountId, targetKey)) || (await accountFollowsAlias(targetAccountId, me));
    if (!inNetwork) throw new DmError("OUTSIDE_NETWORK", "Follow this person first, or upgrade to OUT+ to message people outside your network.", 403, { upgrade: "plus" });
  }

  if (conv) {
    if (conv.status === "active") return { conversationId: conv.id, alreadyActive: true };
    if (conv.status === "pending") {
      if (conv.initiator_key === me) throw new DmError("PENDING", "Your request is waiting for a reply.", 409);
      // They had already asked us — sending to them is the same as accepting.
      return { conversationId: conv.id, theyAskedFirst: true };
    }
    // declined: cool-down before asking again
    const until = new Date(conv.declined_at).getTime() + DM_LIMITS.declineCooldownMs;
    if (Date.now() < until && conv.initiator_key === me) throw new DmError("COOLDOWN", "You can't send a new request to this person right now.", 403);
    await contentDb.prepare("UPDATE dm_conversations SET status = 'pending', initiator_key = ?, declined_at = NULL, priority = ? WHERE id = ?").run(me, perks.priority, conv.id);
    await contentDb.prepare("DELETE FROM dm_messages WHERE conversation_id = ?").run(conv.id);
  } else {
    const [a, b] = [me, targetKey].sort();
    const id = crypto.randomUUID();
    await contentDb.prepare(
      "INSERT INTO dm_conversations (id, pair_key, a_key, b_key, initiator_key, status, created_at, last_message_at, priority) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)"
    ).run(id, key, a, b, me, t, t, perks.priority);
    for (const k of [me, targetKey]) {
      await contentDb.prepare("INSERT INTO dm_members (conversation_id, anon_key) VALUES (?, ?) ON CONFLICT DO NOTHING").run(id, k);
    }
    conv = { id };
  }

  await insertMessage({ conversationId: conv.id, sender: me, text: body, replyTo: null, clientId: crypto.randomUUID(), ttl: 0 });
  await contentDb.prepare("UPDATE dm_members SET cleared_at = NULL, archived = 0 WHERE conversation_id = ? AND anon_key = ?").run(conv.id, targetKey);

  const alias = (await getAliasHandles([me])).get(me);
  await createNotification(targetAccountId, "message_request", perks.priority ? `Priority request: ${alias?.displayLabel || "Someone"} wants to message you.` : `${alias?.displayLabel || "Someone"} wants to message you.`, null);
  return { conversationId: conv.id, created: true };
}

export async function respondToRequest({ me, conversationId, action }) {
  const c = await loadConversation(conversationId, me);
  if (c.status !== "pending" || c.initiator_key === me) throw new DmError("NOT_PENDING", "There's no request to respond to.", 409);
  const them = otherOf(c, me);
  if (action === "accept") {
    await contentDb.prepare("UPDATE dm_conversations SET status = 'active', accepted_at = ? WHERE id = ?").run(nowIso(), c.id);
    const acc = await resolveAliasAccountId(them);
    const alias = (await getAliasHandles([me])).get(me);
    if (acc) await createNotification(acc, "message_accepted", `${alias?.displayLabel || "Someone"} accepted your message request.`, null);
    return { status: "active" };
  }
  if (action === "decline") {
    await contentDb.prepare("UPDATE dm_conversations SET status = 'declined', declined_at = ? WHERE id = ?").run(nowIso(), c.id);
    return { status: "declined" }; // the sender is not told
  }
  if (action === "block") {
    await blockUser({ me, targetKey: them });
    await contentDb.prepare("UPDATE dm_conversations SET status = 'declined', declined_at = ? WHERE id = ?").run(nowIso(), c.id);
    return { status: "blocked" };
  }
  throw new DmError("BAD_ACTION", "Unknown action.");
}

// ---------- messages ----------
async function insertMessage({ conversationId, sender, text, replyTo, clientId, ttl }) {
  const id = crypto.randomUUID();
  const t = nowIso();
  const expires = ttl > 0 ? new Date(Date.now() + ttl * 1000).toISOString() : null;
  const res = await contentDb.prepare(
    `INSERT INTO dm_messages (id, conversation_id, sender_key, body_enc, reply_to, client_id, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (conversation_id, sender_key, client_id) DO NOTHING RETURNING id`
  ).get(id, conversationId, sender, encryptMessage(conversationId, sender, text), replyTo, clientId, t, expires);
  if (!res) {
    // A retry of a send that already succeeded: return the original.
    return (await contentDb.prepare("SELECT id FROM dm_messages WHERE conversation_id = ? AND sender_key = ? AND client_id = ?").get(conversationId, sender, clientId)).id;
  }
  await contentDb.prepare("UPDATE dm_conversations SET last_message_at = ? WHERE id = ?").run(t, conversationId);
  await contentDb.prepare("UPDATE dm_members SET typing_at = NULL, last_seen_at = ? WHERE conversation_id = ? AND anon_key = ?").run(t, conversationId, sender);
  return id;
}

export async function sendMessage({ me, conversationId, text, replyTo = null, clientId, tier = "basic", attachment = null }) {
  const c = await loadConversation(conversationId, me);
  const them = otherOf(c, me);
  if (c.status !== "active") {
    throw new DmError(c.status === "pending" ? "PENDING" : "UNAVAILABLE", c.status === "pending" ? "Messages unlock once the request is accepted." : "You can't message this person.", c.status === "pending" ? 409 : 403);
  }
  if (await blockedEitherWay(me, them)) throw new DmError("UNAVAILABLE", "You can't message this person.", 403);
  let body;
  if (attachment) {
    const a = validateAttachment(attachment, tier);
    const caption = String(text ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, 1000);
    body = packEnvelope(caption, a);
  } else body = cleanText(text, messagingFor(tier).maxLen);
  if (replyTo) {
    const r = await contentDb.prepare("SELECT 1 AS x FROM dm_messages WHERE id = ? AND conversation_id = ?").get(replyTo, c.id);
    if (!r) replyTo = null;
  }
  const id = await insertMessage({ conversationId: c.id, sender: me, text: body, replyTo, clientId: String(clientId || crypto.randomUUID()).slice(0, 64), ttl: c.ttl_seconds });
  await contentDb.prepare("UPDATE dm_members SET cleared_at = NULL, archived = 0 WHERE conversation_id = ? AND anon_key = ? ").run(c.id, them);
  await maybeNotify(c, me, them);
  return getMessage(id, me);
}

// Push/in-app notification — only when the recipient isn't looking at this
// chat right now, not muted, and not more than once every couple of minutes.
// The notification never contains message text.
async function maybeNotify(c, me, them) {
  const mem = await contentDb.prepare("SELECT * FROM dm_members WHERE conversation_id = ? AND anon_key = ?").get(c.id, them);
  if (!mem || mem.muted) return;
  const t = Date.now();
  if (mem.last_seen_at && t - new Date(mem.last_seen_at).getTime() < DM_LIMITS.activeWindowMs) return;
  if (mem.last_notified_at && t - new Date(mem.last_notified_at).getTime() < DM_LIMITS.notifyEveryMs) return;
  const acc = await resolveAliasAccountId(them);
  if (!acc) return;
  const alias = (await getAliasHandles([me])).get(me);
  await contentDb.prepare("UPDATE dm_members SET last_notified_at = ? WHERE conversation_id = ? AND anon_key = ?").run(nowIso(), c.id, them);
  await createNotification(acc, "message", `New message from ${alias?.displayLabel || "someone"}.`, null);
}

function shape(row, me, reactions, reply) {
  const deleted = !!row.deleted_at;
  const dec = deleted ? { text: "", attachment: null } : unpackEnvelope(decryptMessage(row.conversation_id, row.sender_key, row.body_enc));
  return {
    id: row.id,
    mine: row.sender_key === me,
    text: dec.text,
    attachment: dec.attachment,
    deleted,
    createdAt: row.created_at,
    editedAt: row.edited_at || null,
    expiresAt: row.expires_at || null,
    replyTo: reply || null,
    reactions: reactions || { total: 0, top: [], mine: null },
  };
}

async function hydrate(rows, me) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const ph = ids.map(() => "?").join(",");
  const rx = await contentDb.prepare(`SELECT message_id, anon_key, reaction FROM dm_reactions WHERE message_id IN (${ph})`).all(...ids);
  const byMsg = {};
  for (const r of rx) {
    const e = (byMsg[r.message_id] ||= { counts: new Map(), mine: null, total: 0 });
    e.counts.set(r.reaction, (e.counts.get(r.reaction) || 0) + 1);
    e.total++;
    if (r.anon_key === me) e.mine = r.reaction;
  }
  const replyIds = [...new Set(rows.map((r) => r.reply_to).filter(Boolean))];
  let replies = {};
  if (replyIds.length) {
    const rp = replyIds.map(() => "?").join(",");
    const rr = await contentDb.prepare(`SELECT * FROM dm_messages WHERE id IN (${rp})`).all(...replyIds);
    replies = Object.fromEntries(rr.map((r) => [r.id, {
      id: r.id, mine: r.sender_key === me, deleted: !!r.deleted_at,
      text: r.deleted_at ? "" : (() => { const d = unpackEnvelope(decryptMessage(r.conversation_id, r.sender_key, r.body_enc)); return clip(d.text || attachLabel(d.attachment), 140); })(),
    }]));
  }
  return rows.map((r) => {
    const e = byMsg[r.id];
    return shape(r, me,
      e ? { total: e.total, top: [...e.counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3), mine: e.mine } : null,
      r.reply_to ? replies[r.reply_to] || { id: r.reply_to, deleted: true, text: "", mine: false } : null);
  });
}

async function getMessage(id, me) {
  const row = await contentDb.prepare("SELECT * FROM dm_messages WHERE id = ?").get(id);
  return (await hydrate([row], me))[0];
}

export async function getConversation({ me, myAccountId, conversationId, after = null, before = null, limit = 50 }) {
  await purgeExpired();
  const c = await loadConversation(conversationId, me);
  const them = otherOf(c, me);
  const mem = await contentDb.prepare("SELECT * FROM dm_members WHERE conversation_id = ? AND anon_key = ?").get(c.id, me);
  const theirMem = await contentDb.prepare("SELECT * FROM dm_members WHERE conversation_id = ? AND anon_key = ?").get(c.id, them);
  const lim = Math.max(1, Math.min(100, Number(limit) || 50));
  const clearedAt = mem?.cleared_at || "1970-01-01T00:00:00.000Z";

  let rows;
  if (after) {
    rows = await contentDb.prepare("SELECT * FROM dm_messages WHERE conversation_id = ? AND created_at > ? AND created_at > ? ORDER BY created_at ASC LIMIT 200").all(c.id, after, clearedAt);
  } else if (before) {
    rows = (await contentDb.prepare("SELECT * FROM dm_messages WHERE conversation_id = ? AND created_at < ? AND created_at > ? ORDER BY created_at DESC LIMIT ?").all(c.id, before, clearedAt, lim)).reverse();
  } else {
    rows = (await contentDb.prepare("SELECT * FROM dm_messages WHERE conversation_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT ?").all(c.id, clearedAt, lim)).reverse();
  }
  // Heartbeat: being in the chat means no push for new messages.
  await contentDb.prepare("UPDATE dm_members SET last_seen_at = ? WHERE conversation_id = ? AND anon_key = ?").run(nowIso(), c.id, me);

  const theirAccount = await resolveAliasAccountId(them);
  const [myPrefs, theirPrefs] = [await getDmPrefs(myAccountId), theirAccount ? await getDmPrefs(theirAccount) : null];
  const typingFresh = theirMem?.typing_at && Date.now() - new Date(theirMem.typing_at).getTime() < DM_LIMITS.typingTtlMs;
  const receipts = myPrefs.readReceipts && theirPrefs?.readReceipts;
  const info = (await getAliasHandles([them])).get(them);

  return {
    id: c.id,
    status: c.status,
    iAmInitiator: c.initiator_key === me,
    awaitingMyResponse: c.status === "pending" && c.initiator_key !== me,
    other: { handle: them, displayLabel: info?.displayLabel || "Unknown", avatarUrl: info?.avatarUrl || null },
    ttlSeconds: c.ttl_seconds,
    muted: !!mem?.muted,
    blocked: Boolean(await contentDb.prepare("SELECT 1 AS x FROM dm_blocks WHERE blocker_key = ? AND blocked_key = ?").get(me, them)),
    otherTyping: !!typingFresh && myPrefs.typing && !!theirPrefs?.typing,
    otherLastReadAt: receipts ? theirMem?.last_read_at || null : null,
    readReceipts: receipts,
    messages: await hydrate(rows, me),
    hasMore: !after && rows.length === lim,
    serverTime: nowIso(),
  };
}

export async function markRead({ me, conversationId }) {
  const c = await loadConversation(conversationId, me);
  await contentDb.prepare("UPDATE dm_members SET last_read_at = ?, last_seen_at = ? WHERE conversation_id = ? AND anon_key = ?").run(nowIso(), nowIso(), c.id, me);
  return { ok: true };
}

export async function setTyping({ me, conversationId }) {
  const c = await loadConversation(conversationId, me);
  if (c.status !== "active") return { ok: false };
  await contentDb.prepare("UPDATE dm_members SET typing_at = ? WHERE conversation_id = ? AND anon_key = ?").run(nowIso(), c.id, me);
  return { ok: true };
}

export async function editMessage({ me, messageId, text }) {
  const m = await contentDb.prepare("SELECT * FROM dm_messages WHERE id = ?").get(messageId);
  if (!m || m.sender_key !== me) throw new DmError("NOT_FOUND", "Message not found.", 404);
  await loadConversation(m.conversation_id, me);
  if (m.deleted_at) throw new DmError("DELETED", "That message was deleted.", 410);
  if (Date.now() - new Date(m.created_at).getTime() > DM_LIMITS.editWindowMs) throw new DmError("TOO_OLD", "Messages can only be edited for 15 minutes.", 403);
  if (unpackEnvelope(decryptMessage(m.conversation_id, me, m.body_enc)).attachment) throw new DmError("NOT_EDITABLE", "Voice notes, files and stickers can't be edited. Delete and send again.", 400);
  const body = cleanText(text, DM_LIMITS.maxLen);
  await contentDb.prepare("UPDATE dm_messages SET body_enc = ?, edited_at = ? WHERE id = ?").run(encryptMessage(m.conversation_id, me, body), nowIso(), messageId);
  return getMessage(messageId, me);
}

// "Delete for everyone": the ciphertext is wiped, not just hidden.
export async function deleteMessage({ me, messageId }) {
  const m = await contentDb.prepare("SELECT * FROM dm_messages WHERE id = ?").get(messageId);
  if (!m || m.sender_key !== me) throw new DmError("NOT_FOUND", "Message not found.", 404);
  await loadConversation(m.conversation_id, me);
  await contentDb.prepare("UPDATE dm_messages SET body_enc = NULL, deleted_at = ? WHERE id = ?").run(nowIso(), messageId);
  await contentDb.prepare("DELETE FROM dm_reactions WHERE message_id = ?").run(messageId);
  return { deleted: true };
}

export async function reactToMessage({ me, messageId, reaction }) {
  if (!isValidReaction(reaction)) throw new DmError("BAD_REACTION", "That isn't a valid reaction.");
  const m = await contentDb.prepare("SELECT * FROM dm_messages WHERE id = ?").get(messageId);
  if (!m) throw new DmError("NOT_FOUND", "Message not found.", 404);
  const c = await loadConversation(m.conversation_id, me);
  if (c.status !== "active" || m.deleted_at) throw new DmError("UNAVAILABLE", "You can't react to that.", 403);
  if (await blockedEitherWay(me, otherOf(c, me))) throw new DmError("UNAVAILABLE", "You can't message this person.", 403);
  const cur = await contentDb.prepare("SELECT reaction FROM dm_reactions WHERE message_id = ? AND anon_key = ?").get(messageId, me);
  if (cur?.reaction === reaction) await contentDb.prepare("DELETE FROM dm_reactions WHERE message_id = ? AND anon_key = ?").run(messageId, me);
  else await contentDb.prepare(
    "INSERT INTO dm_reactions (message_id, anon_key, reaction, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (message_id, anon_key) DO UPDATE SET reaction = EXCLUDED.reaction, created_at = EXCLUDED.created_at"
  ).run(messageId, me, reaction, nowIso());
  return getMessage(messageId, me);
}

// ---------- inbox ----------
export async function listConversations({ me, box = "inbox" }) {
  await purgeExpired();
  const rows = await contentDb.prepare(
    `SELECT c.*, m.muted, m.archived, m.cleared_at, m.last_read_at
     FROM dm_conversations c JOIN dm_members m ON m.conversation_id = c.id AND m.anon_key = ?
     WHERE (c.a_key = ? OR c.b_key = ?) AND c.status != 'declined'
       AND NOT EXISTS (SELECT 1 FROM dm_blocks b WHERE b.blocker_key = ? AND b.blocked_key = (CASE WHEN c.a_key = ? THEN c.b_key ELSE c.a_key END))
     ORDER BY c.last_message_at DESC LIMIT 200`
  ).all(me, me, me, me, me);
  const visible = rows.sort((x, y) => (box === "requests" ? Number(!!y.priority) - Number(!!x.priority) : 0) || String(y.last_message_at).localeCompare(String(x.last_message_at))).filter((c) => {
    const incomingRequest = c.status === "pending" && c.initiator_key !== me;
    if (box === "requests") return incomingRequest;
    if (box === "archived") return !incomingRequest && c.archived;
    return !incomingRequest && !c.archived;
  }).filter((c) => !c.cleared_at || c.last_message_at > c.cleared_at);
  if (visible.length === 0) return [];

  const ids = visible.map((c) => c.id);
  const ph = ids.map(() => "?").join(",");
  const last = await contentDb.prepare(
    `SELECT DISTINCT ON (conversation_id) * FROM dm_messages WHERE conversation_id IN (${ph}) ORDER BY conversation_id, created_at DESC`
  ).all(...ids);
  const lastBy = Object.fromEntries(last.map((m) => [m.conversation_id, m]));
  const unread = await contentDb.prepare(
    `SELECT m.conversation_id AS id, COUNT(*) AS n FROM dm_messages m
     JOIN dm_members mem ON mem.conversation_id = m.conversation_id AND mem.anon_key = ?
     WHERE m.conversation_id IN (${ph}) AND m.sender_key != ? AND m.deleted_at IS NULL
       AND m.created_at > COALESCE(mem.last_read_at, '1970-01-01') AND m.created_at > COALESCE(mem.cleared_at, '1970-01-01')
     GROUP BY m.conversation_id`
  ).all(me, ...ids, me);
  const unreadBy = Object.fromEntries(unread.map((u) => [u.id, Number(u.n)]));
  const handles = await getAliasHandles(visible.map((c) => otherOf(c, me)));

  return visible.map((c) => {
    const them = otherOf(c, me);
    const lm = lastBy[c.id];
    const info = handles.get(them);
    return {
      id: c.id,
      other: { handle: them, displayLabel: info?.displayLabel || "Unknown", avatarUrl: info?.avatarUrl || null },
      status: c.status,
      priority: !!c.priority && c.status === "pending" && c.initiator_key !== me,
      requestSentByMe: c.status === "pending" && c.initiator_key === me,
      lastMessage: lm ? {
        mine: lm.sender_key === me, deleted: !!lm.deleted_at, createdAt: lm.created_at,
        text: lm.deleted_at ? "" : (() => { const d = unpackEnvelope(decryptMessage(c.id, lm.sender_key, lm.body_enc)); return clip(d.text || attachLabel(d.attachment), DM_LIMITS.previewLen); })(),
      } : null,
      unread: unreadBy[c.id] || 0,
      muted: !!c.muted,
      lastMessageAt: c.last_message_at,
    };
  });
}

export async function unreadSummary(me) {
  const rows = await contentDb.prepare(
    `SELECT c.status, c.initiator_key, COUNT(m.id) AS n
     FROM dm_conversations c
     JOIN dm_members mem ON mem.conversation_id = c.id AND mem.anon_key = ?
     LEFT JOIN dm_messages m ON m.conversation_id = c.id AND m.sender_key != ? AND m.deleted_at IS NULL
       AND (m.expires_at IS NULL OR m.expires_at > ?)
       AND m.created_at > COALESCE(mem.last_read_at, '1970-01-01') AND m.created_at > COALESCE(mem.cleared_at, '1970-01-01')
     WHERE (c.a_key = ? OR c.b_key = ?) AND c.status != 'declined' AND mem.muted = 0
       AND NOT EXISTS (SELECT 1 FROM dm_blocks b WHERE b.blocker_key = ? AND b.blocked_key = (CASE WHEN c.a_key = ? THEN c.b_key ELSE c.a_key END))
     GROUP BY c.id, c.status, c.initiator_key`
  ).all(me, me, nowIso(), me, me, me, me);
  let unread = 0, requests = 0;
  for (const r of rows) {
    if (r.status === "pending" && r.initiator_key !== me) requests++;
    else unread += Number(r.n);
  }
  return { unread, requests, total: unread + requests };
}

// ---------- conversation settings, blocks, reports ----------
export async function updateConversation({ me, conversationId, muted, archived, ttlSeconds }) {
  const c = await loadConversation(conversationId, me);
  if (typeof muted === "boolean") await contentDb.prepare("UPDATE dm_members SET muted = ? WHERE conversation_id = ? AND anon_key = ?").run(muted ? 1 : 0, c.id, me);
  if (typeof archived === "boolean") await contentDb.prepare("UPDATE dm_members SET archived = ? WHERE conversation_id = ? AND anon_key = ?").run(archived ? 1 : 0, c.id, me);
  if (ttlSeconds !== undefined) {
    if (!TTL_OPTIONS.includes(Number(ttlSeconds))) throw new DmError("BAD_TTL", "Invalid timer.");
    if (c.status !== "active") throw new DmError("NOT_ACTIVE", "Timers can be set once the chat is active.", 409);
    await contentDb.prepare("UPDATE dm_conversations SET ttl_seconds = ? WHERE id = ?").run(Number(ttlSeconds), c.id);
  }
  return { ok: true };
}

// "Delete chat" removes it for YOU only: it hides everything up to now.
export async function clearConversation({ me, conversationId }) {
  const c = await loadConversation(conversationId, me);
  await contentDb.prepare("UPDATE dm_members SET cleared_at = ?, archived = 0 WHERE conversation_id = ? AND anon_key = ?").run(nowIso(), c.id, me);
  return { ok: true };
}

export async function blockUser({ me, targetKey }) {
  if (!targetKey || targetKey === me) throw new DmError("BAD_TARGET", "Invalid target.");
  await contentDb.prepare("INSERT INTO dm_blocks (blocker_key, blocked_key, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").run(me, targetKey, nowIso());
  return { blocked: true };
}
export async function unblockUser({ me, targetKey }) {
  await contentDb.prepare("DELETE FROM dm_blocks WHERE blocker_key = ? AND blocked_key = ?").run(me, targetKey);
  return { blocked: false };
}
export async function listBlocks(me) {
  const rows = await contentDb.prepare("SELECT blocked_key FROM dm_blocks WHERE blocker_key = ? ORDER BY created_at DESC").all(me);
  const handles = await getAliasHandles(rows.map((r) => r.blocked_key));
  return rows.map((r) => ({ handle: r.blocked_key, displayLabel: handles.get(r.blocked_key)?.displayLabel || "Unknown", avatarUrl: handles.get(r.blocked_key)?.avatarUrl || null }));
}

// A report packages the last 10 messages (decrypted, re-encrypted under the
// report) as evidence for an operator. Only the reporter chooses to share it.
export async function reportConversation({ me, conversationId, reason, details }) {
  const c = await loadConversation(conversationId, me);
  if (!REPORT_REASONS[reason]) throw new DmError("BAD_REASON", "Choose a reason.");
  const them = otherOf(c, me);
  const recent = (await contentDb.prepare("SELECT * FROM dm_messages WHERE conversation_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 10").all(c.id)).reverse();
  const evidence = JSON.stringify(recent.map((m) => ({ from: m.sender_key === me ? "reporter" : "reported", at: m.created_at, text: (() => { const d = unpackEnvelope(decryptMessage(c.id, m.sender_key, m.body_enc)); return d.attachment ? `${d.text} [${d.attachment.type}: ${d.attachment.url}]`.trim() : d.text; })() })));
  const id = crypto.randomUUID();
  await contentDb.prepare(
    "INSERT INTO dm_reports (id, conversation_id, reporter_key, reported_key, reason, details, evidence_enc, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, c.id, me, them, reason, String(details || "").slice(0, 1000), encryptMessage(`report:${id}`, me, evidence), nowIso());
  await blockUser({ me, targetKey: them }); // reporting also blocks
  return { id };
}


// ---------- Message analytics (OUT PRO) ----------
// Aggregates only. Never exposes who declined: a request that was not accepted
// is "not accepted" whether it was declined or ignored.
export async function messageAnalytics({ me, days = 30 }) {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const num = async (sql, ...a) => Number((await contentDb.prepare(sql).get(...a))?.n || 0);
  const sent = await num("SELECT COUNT(*) AS n FROM dm_messages WHERE sender_key = ? AND created_at > ? AND deleted_at IS NULL", me, since);
  const received = await num("SELECT COUNT(*) AS n FROM dm_messages m JOIN dm_conversations c ON c.id = m.conversation_id WHERE (c.a_key = ? OR c.b_key = ?) AND m.sender_key != ? AND m.created_at > ? AND m.deleted_at IS NULL", me, me, me, since);
  const reqSent = await num("SELECT COUNT(*) AS n FROM dm_conversations WHERE initiator_key = ? AND created_at > ?", me, since);
  const reqAccepted = await num("SELECT COUNT(*) AS n FROM dm_conversations WHERE initiator_key = ? AND created_at > ? AND accepted_at IS NOT NULL", me, since);
  const reqPending = await num("SELECT COUNT(*) AS n FROM dm_conversations WHERE initiator_key = ? AND created_at > ? AND status = 'pending'", me, since);
  const active = await num("SELECT COUNT(*) AS n FROM dm_conversations WHERE (a_key = ? OR b_key = ?) AND status = 'active' AND last_message_at > ?", me, me, since);
  const incomingPending = await num("SELECT COUNT(*) AS n FROM dm_conversations WHERE (a_key = ? OR b_key = ?) AND initiator_key != ? AND status = 'pending'", me, me, me);
  // Daily volume (sent vs received) for a sparkline.
  const daily = await contentDb.prepare(
    `SELECT substr(m.created_at, 1, 10) AS d, SUM(CASE WHEN m.sender_key = ? THEN 1 ELSE 0 END) AS sent, SUM(CASE WHEN m.sender_key != ? THEN 1 ELSE 0 END) AS received
     FROM dm_messages m JOIN dm_conversations c ON c.id = m.conversation_id
     WHERE (c.a_key = ? OR c.b_key = ?) AND m.created_at > ? AND m.deleted_at IS NULL GROUP BY 1 ORDER BY 1`
  ).all(me, me, me, me, since);
  // Median time-to-accept on requests you sent.
  const acc = await contentDb.prepare("SELECT created_at, accepted_at FROM dm_conversations WHERE initiator_key = ? AND accepted_at IS NOT NULL AND created_at > ?").all(me, since);
  const waits = acc.map((r) => new Date(r.accepted_at) - new Date(r.created_at)).filter((x) => x >= 0).sort((a, b) => a - b);
  const medianAcceptMin = waits.length ? Math.round(waits[Math.floor(waits.length / 2)] / 60000) : null;
  const hours = await contentDb.prepare("SELECT substr(created_at, 12, 2) AS h, COUNT(*) AS n FROM dm_messages WHERE sender_key = ? AND created_at > ? GROUP BY 1 ORDER BY n DESC LIMIT 1").get(me, since);
  return {
    days, sent, received, requestsSent: reqSent, requestsAccepted: reqAccepted, requestsPending: reqPending,
    acceptRate: reqSent ? Math.round((reqAccepted / reqSent) * 100) : null,
    replyRatio: sent ? Math.round((received / sent) * 100) : null,
    activeConversations: active, incomingPending, medianAcceptMinutes: medianAcceptMin,
    busiestHourUtc: hours ? Number(hours.h) : null,
    daily: daily.map((r) => ({ day: r.d, sent: Number(r.sent), received: Number(r.received) })),
  };
}
