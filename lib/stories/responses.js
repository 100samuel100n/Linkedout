// Replies to Stories, shaped by what the author asked for ("Support", "Advice", "Warn others", "Find others who experienced this").
// Before this, those choices were only labels. Now each one has a real workflow:
//   support      -> readers leave supportive replies (kind "support")
//   advice       -> readers leave advice (kind "advice"); switched off when the author ticked "no advice"
//   warn         -> readers add what to watch for / confirm the warning (kind "warn")
//   find_others  -> readers say they went through it too (kind "connect"); the author is notified each time, and the
//                   replies are the meeting point (nobody's identity is revealed; everyone appears under an alias)
// Plus plain "reply". Replies are redacted for personal details like stories are, are rate-limited, can be deleted by their
// author, and by the story's author on their own story. Everything references alias ids only.
import crypto from "node:crypto";
import { contentDb } from "../content/db.js";
import { redactFields } from "./redact.js";
import { resolveAliasAccountId, createNotification } from "../identity/service.js";

export const RESPONSE_KINDS = [
  { key: "support", label: "Support", prompt: "Say something kind" },
  { key: "advice", label: "Advice", prompt: "Share advice that helped you" },
  { key: "warn", label: "Warn others", prompt: "What should others watch for?" },
  { key: "connect", label: "Me too, let's connect", prompt: "What happened to you? Others in the same spot will see this" },
  { key: "reply", label: "Reply", prompt: "Write a reply" },
];
const KEYS = RESPONSE_KINDS.map((k) => k.key);
const bad = (m, status = 400, code = "BAD_REQUEST") => Object.assign(new Error(m), { status, code });
const iso = () => new Date().toISOString();

let ready = false;
export async function ensureResponses() {
  if (ready) return;
  await contentDb.exec(`CREATE TABLE IF NOT EXISTS story_responses (
    id TEXT PRIMARY KEY, story_id TEXT NOT NULL, parent_id TEXT, kind TEXT NOT NULL DEFAULT 'reply', body TEXT NOT NULL,
    anonymous_id TEXT, author_display TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'published', created_at TEXT NOT NULL)`);
  await contentDb.exec("CREATE INDEX IF NOT EXISTS idx_story_responses_story ON story_responses (story_id, created_at)");
  ready = true;
}

const parse = (s, d) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : d; } catch { return d; } };

// What the author asked for decides which kinds are offered first. Reply is always available.
export function offeredKinds(story) {
  const wants = parse(story.wants, []);
  const out = new Set(["reply"]);
  if (wants.includes("support") || !wants.length) out.add("support");
  if ((wants.includes("advice") || !wants.length) && !story.no_advice) out.add("advice");
  if (wants.includes("warn") || wants.includes("learn")) out.add("warn");
  if (wants.includes("find_others")) out.add("connect");
  // someone who went through the same thing can always say so, and anyone can support
  out.add("support"); out.add("connect"); if (!story.no_advice) out.add("advice"); out.add("warn");
  return { offered: KEYS.filter((k) => out.has(k)), requested: wants.filter((w) => ["support", "advice", "warn", "find_others"].includes(w)).map((w) => (w === "find_others" ? "connect" : w)) };
}

export async function listResponses(storyId, viewerKey) {
  await ensureResponses();
  const s = await contentDb.prepare("SELECT id, wants, no_advice, status, anonymous_id FROM stories WHERE id = ?").get(storyId);
  if (!s || s.status === "removed") throw bad("Story not found.", 404, "NOT_FOUND");
  if (s.status !== "published" && !(viewerKey && s.anonymous_id === viewerKey)) throw bad("Story not found.", 404, "NOT_FOUND");
  const rows = await contentDb.prepare("SELECT id, parent_id, kind, body, author_display, anonymous_id, created_at FROM story_responses WHERE story_id = ? AND status = 'published' ORDER BY created_at ASC LIMIT 400").all(storyId);
  const counts = Object.fromEntries(KEYS.map((k) => [k, 0])); rows.forEach((r) => { counts[r.kind] = (counts[r.kind] || 0) + 1; });
  const { offered, requested } = offeredKinds(s);
  return {
    kinds: RESPONSE_KINDS.filter((k) => offered.includes(k.key)), requested, counts,
    responses: rows.map((r) => ({ id: r.id, parentId: r.parent_id, kind: r.kind, body: r.body, author: r.author_display, createdAt: r.created_at, mine: !!viewerKey && r.anonymous_id === viewerKey, byStoryAuthor: !!s.anonymous_id && r.anonymous_id === s.anonymous_id })),
  };
}

export async function addResponse(storyId, identity, { kind = "reply", body, parentId = null }) {
  await ensureResponses();
  const k = KEYS.includes(kind) ? kind : "reply";
  const s = await contentDb.prepare("SELECT id, wants, no_advice, status, anonymous_id, title FROM stories WHERE id = ?").get(storyId);
  if (!s || s.status !== "published") throw bad("Story not found.", 404, "NOT_FOUND");
  if (k === "advice" && s.no_advice) throw bad("The author asked not to receive advice on this story. You can leave support instead.", 400, "NO_ADVICE");
  const text = String(body ?? "").trim();
  if (text.length < 2) throw bad("Write a reply first.");
  if (text.length > 2000) throw bad("Replies can be up to 2,000 characters.");
  if (parentId) {
    const p = await contentDb.prepare("SELECT id FROM story_responses WHERE id = ? AND story_id = ? AND status = 'published'").get(parentId, storyId);
    if (!p) throw bad("The reply you're answering is gone.", 404, "NOT_FOUND");
  }
  const dup = await contentDb.prepare("SELECT id FROM story_responses WHERE story_id = ? AND anonymous_id = ? AND body = ? AND created_at > ?").get(storyId, identity.anonymousId, text, new Date(Date.now() - 120000).toISOString());
  if (dup) return { id: dup.id, duplicate: true };
  const { values, counts } = redactFields({ body: text });
  const id = crypto.randomUUID();
  await contentDb.prepare("INSERT INTO story_responses (id, story_id, parent_id, kind, body, anonymous_id, author_display, status, created_at) VALUES (?,?,?,?,?,?,?,'published',?)")
    .run(id, storyId, parentId || null, k, values.body, identity.anonymousId, identity.displayLabel, iso());
  // Tell the story's author (never reveals who), unless they replied to themselves.
  if (s.anonymous_id && s.anonymous_id !== identity.anonymousId) {
    (async () => {
      const accountId = await resolveAliasAccountId(s.anonymous_id); if (!accountId) return;
      const what = { support: "left you support", advice: "shared advice", warn: "added a warning for others", connect: "says this happened to them too", reply: "replied" }[k];
      await createNotification(accountId, "story", `${identity.displayLabel} ${what} on your story${s.title ? ` “${String(s.title).slice(0, 60)}”` : ""}.`, null);
    })().catch(() => {});
  }
  return { id, redactions: counts };
}

export async function removeResponse(storyId, responseId, viewerKey) {
  await ensureResponses();
  const r = await contentDb.prepare("SELECT r.id, r.anonymous_id, s.anonymous_id AS story_owner FROM story_responses r JOIN stories s ON s.id = r.story_id WHERE r.id = ? AND r.story_id = ?").get(responseId, storyId);
  if (!r) throw bad("Reply not found.", 404, "NOT_FOUND");
  if (!viewerKey || (r.anonymous_id !== viewerKey && r.story_owner !== viewerKey)) throw bad("You can only remove your own replies, or replies on your own story.", 403, "FORBIDDEN");
  await contentDb.prepare("UPDATE story_responses SET status = 'removed' WHERE id = ?").run(responseId);
  return { ok: true };
}
