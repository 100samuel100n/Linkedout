// Admin control over how an author's name appears on stories.
// author_display is stored next to every piece of content (denormalised), so "interconnected" means updating every row
// that belongs to the same author identity, not just the story that was clicked. Scope:
//   story  -> only this story
//   author -> every story, Pulse post, reply and reality check written under the same anonymous identity
// A renamed story is locked (stories.alias_locked) so a later draft edit by the author doesn't overwrite the admin's choice.
// Previous names are snapshotted in the audit log so Undo puts every row back exactly as it was.
import { contentDb } from "@/lib/content/db";
import { logStaff } from "./enforce.js";
import { registerUndo } from "./history.js";
import { suggestLabels } from "@/lib/identity/alias.js";

const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const TABLES = [["stories", true], ["posts", false], ["comments", false], ["claim_checks", false], ["story_responses", false]];
const LIMIT = 5000;

export function cleanName(raw) {
  const n = String(raw ?? "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim();
  if (n.length < 3) throw bad("The name must be at least 3 characters.");
  if (n.length > 48) throw bad("The name can be at most 48 characters.");
  return n;
}

export async function renameAuthor(staff, storyId, rawName, scope = "story", reason = "") {
  const name = cleanName(rawName);
  const s = await contentDb.prepare("SELECT id, anonymous_id, author_display, mode FROM stories WHERE id = ?").get(storyId);
  if (!s) throw bad("Story not found.", 404);
  const snap = [];
  if (scope === "author") {
    if (!s.anonymous_id) throw bad("This story has no author identity to apply to (it was posted under a real name). Rename just this story instead.");
    for (const [t] of TABLES) {
      let rows = [];
      try { rows = await contentDb.prepare(`SELECT id, author_display FROM ${t} WHERE anonymous_id = ? LIMIT ${LIMIT + 1}`).all(s.anonymous_id); } catch { continue; }   // table may not exist yet
      if (rows.length > LIMIT) throw bad("This author has too many items to rename at once.");
      if (rows.length) snap.push({ t, rows: rows.map((r) => [r.id, r.author_display]) });
    }
    for (const part of snap) for (const [id] of part.rows) await contentDb.prepare(`UPDATE ${part.t} SET author_display = ?${part.t === "stories" ? ", alias_locked = 1" : ""} WHERE id = ?`).run(name, id);
  } else {
    snap.push({ t: "stories", rows: [[s.id, s.author_display]] });
    await contentDb.prepare("UPDATE stories SET author_display = ?, alias_locked = 1 WHERE id = ?").run(name, storyId);
  }
  const n = snap.reduce((a, p) => a + p.rows.length, 0);
  await logStaff(staff, "alias:rename", storyId, `"${s.author_display}" → "${name}" (${scope === "author" ? `${n} items by this author` : "this story"})${reason ? " · " + reason : ""}`, { kind: "alias", data: { snap } });
  return { name, changed: n };
}

registerUndo("alias", async (staff, data) => {
  let n = 0;
  for (const part of data.snap || []) {
    if (!TABLES.some(([t]) => t === part.t)) continue;           // never build SQL from stored text
    for (const [id, old] of part.rows) { await contentDb.prepare(`UPDATE ${part.t} SET author_display = ? WHERE id = ?`).run(old, id); n++; }
  }
  return `Restored ${n} author name(s)`;
});

export async function suggestNames(storyId) {
  const s = await contentDb.prepare("SELECT title, company_name, format FROM stories WHERE id = ?").get(storyId);
  return suggestLabels(6, [s?.format, s?.company_name ? "an employee" : ""].filter(Boolean).join(", "));
}
