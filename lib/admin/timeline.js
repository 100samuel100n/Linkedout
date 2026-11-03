// Admin timeline control: choose WHEN a post / story appears to have been posted.
// One source of truth: everything in the product (Pulse feed order, Awards board, story lists, search, SEO dates, "x ago")
// already reads posts.created_at / stories.created_at, so changing that value changes it everywhere at once.
// Posts and the stories that grew out of them (stories.source_post_id) move together, so the timeline stays consistent.
//   * a time in the past  -> shown as posted then (a draft / scheduled story is published at that time)
//   * a time in the future-> hidden until then (posts: scheduled_at, stories: status 'scheduled' + publish_at; the existing
//                            scheduler publishes them at exactly that time)
// The real time is kept in real_created_at, and every change is written to the audit log with a full snapshot so Undo is exact.
import { contentDb } from "@/lib/content/db";
import { logStaff } from "./enforce.js";
import { registerUndo } from "./history.js";

const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const iso = () => new Date().toISOString();
let ready = false;
async function ensure() {
  if (ready) return;
  await contentDb.prepare("ALTER TABLE posts ADD COLUMN IF NOT EXISTS real_created_at TEXT").run();
  await contentDb.prepare("ALTER TABLE stories ADD COLUMN IF NOT EXISTS real_created_at TEXT").run();
  ready = true;
}

// Accepts "now", ISO ("2026-10-12T14:30:00Z"), or "YYYY-MM-DD HH:MM" (read as UTC) with an optional offset ("+03:00").
export function parseWhen(raw) {
  const v = String(raw ?? "").trim();
  if (!v) throw bad("Enter the date and time (for example 2026-10-12 14:30, or 'now').");
  if (v.toLowerCase() === "now") return iso();
  let s = v.replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += "T12:00:00";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) s += ":00";
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) s += "Z";
  const d = new Date(s);
  if (isNaN(d)) throw bad("That date and time isn't valid. Use a form like 2026-10-12 14:30 (UTC) or 2026-10-12 17:30+03:00.");
  if (d.getTime() < Date.parse("2015-01-01T00:00:00Z")) throw bad("That date is too far in the past.");
  if (d.getTime() > Date.now() + 366 * 864e5) throw bad("That date is more than a year ahead.");
  return d.toISOString();
}
const future = (when) => Date.parse(when) > Date.now() + 60000;

async function applyPost(id, when) {
  if (future(when)) await contentDb.prepare("UPDATE posts SET created_at = ?, scheduled_at = ?, real_created_at = COALESCE(real_created_at, created_at) WHERE id = ?").run(when, when, id);
  else await contentDb.prepare("UPDATE posts SET created_at = ?, scheduled_at = NULL, real_created_at = COALESCE(real_created_at, created_at) WHERE id = ?").run(when, id);
}
async function applyStory(row, when) {
  if (row.status === "removed") return false;
  if (future(when)) await contentDb.prepare("UPDATE stories SET status = 'scheduled', publish_at = ?, created_at = ?, real_created_at = COALESCE(real_created_at, created_at), updated_at = ? WHERE id = ?").run(when, when, iso(), row.id);
  else await contentDb.prepare("UPDATE stories SET status = 'published', publish_at = NULL, created_at = ?, real_created_at = COALESCE(real_created_at, created_at), updated_at = ? WHERE id = ?").run(when, iso(), row.id);
  return true;
}
const snapStory = (r) => ({ id: r.id, created_at: r.created_at, status: r.status, publish_at: r.publish_at, real_created_at: r.real_created_at });

export async function setPostTime(staff, postId, whenRaw, reason = "") {
  await ensure();
  const when = parseWhen(whenRaw);
  const p = await contentDb.prepare("SELECT id, created_at, scheduled_at, real_created_at, repost_of FROM posts WHERE id = ?").get(postId);
  if (!p) throw bad("Post not found.", 404);
  const stories = await contentDb.prepare("SELECT id, status, created_at, publish_at, real_created_at FROM stories WHERE source_post_id = ? AND status IN ('published','scheduled')").all(postId);
  const snap = { posts: [{ id: p.id, created_at: p.created_at, scheduled_at: p.scheduled_at, real_created_at: p.real_created_at }], stories: stories.map(snapStory) };
  await applyPost(postId, when);
  for (const s of stories) await applyStory(s, when);
  await logStaff(staff, "timeline:post", postId, `${p.created_at?.slice(0, 16)} → ${when.slice(0, 16)}${stories.length ? ` (+${stories.length} linked stor${stories.length > 1 ? "ies" : "y"})` : ""}${reason ? " · " + reason : ""}`, { kind: "time", data: snap });
  return { when, linkedStories: stories.length };
}

export async function setStoryTime(staff, storyId, whenRaw, reason = "") {
  await ensure();
  const when = parseWhen(whenRaw);
  const s = await contentDb.prepare("SELECT id, status, created_at, publish_at, real_created_at, source_post_id FROM stories WHERE id = ?").get(storyId);
  if (!s) throw bad("Story not found.", 404);
  if (s.status === "removed") throw bad("Restore this story before changing its time.");
  const snap = { posts: [], stories: [snapStory(s)] };
  if (s.source_post_id) {
    const p = await contentDb.prepare("SELECT id, created_at, scheduled_at, real_created_at FROM posts WHERE id = ?").get(s.source_post_id);
    if (p) { snap.posts.push({ id: p.id, created_at: p.created_at, scheduled_at: p.scheduled_at, real_created_at: p.real_created_at }); await applyPost(p.id, when); }
  }
  await applyStory(s, when);
  await logStaff(staff, "timeline:story", storyId, `${s.status}/${s.created_at?.slice(0, 16)} → ${future(when) ? "scheduled " : "posted "}${when.slice(0, 16)}${reason ? " · " + reason : ""}`, { kind: "time", data: snap });
  return { when, status: future(when) ? "scheduled" : "published" };
}

registerUndo("time", async (staff, data) => {
  await ensure();
  for (const p of data.posts || []) await contentDb.prepare("UPDATE posts SET created_at = ?, scheduled_at = ?, real_created_at = ? WHERE id = ?").run(p.created_at, p.scheduled_at, p.real_created_at, p.id);
  for (const s of data.stories || []) await contentDb.prepare("UPDATE stories SET created_at = ?, status = ?, publish_at = ?, real_created_at = ?, updated_at = ? WHERE id = ?").run(s.created_at, s.status, s.publish_at, s.real_created_at, iso(), s.id);
  return `Restored original time on ${(data.posts || []).length} post(s) and ${(data.stories || []).length} story(ies)`;
});

// Undo for the everyday moderation actions (remove / restore / edit / feature ...). Only the columns that were snapshotted are written back,
// and the column names come from this fixed list, never from stored text.
const STORY_COLS = ["status", "mod_reason", "moderated_by", "moderated_at", "featured", "noindex", "title", "body", "company_name", "updated_at"];
const POST_COLS = ["visibility", "mod_reason", "moderated_by", "moderated_at", "pinned", "cringe_nominated"];
async function restoreRow(table, allowed, data) {
  const cols = Object.keys(data.prev || {}).filter((c) => allowed.includes(c)); if (!cols.length) return 0;
  await contentDb.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(...cols.map((c) => data.prev[c]), data.id);
  return 1;
}
registerUndo("story_state", async (_s, data) => { await ensure(); await restoreRow("stories", STORY_COLS, data); return "Story restored to how it was before the action"; });
registerUndo("post_state", async (_s, data) => { await restoreRow("posts", POST_COLS, data); return "Post restored to how it was before the action"; });
