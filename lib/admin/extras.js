// Adds the timeline, author-name and history/undo controls to existing admin sections without rewriting them.
// Called once at the bottom of lib/admin/service.js with the LIST / ACT registries.
import { setPostTime, setStoryTime } from "./timeline.js";
import { renameAuthor, suggestNames } from "./aliases.js";
import { listHistory, undoAction } from "./history.js";
import { contentDb } from "@/lib/content/db";
import { logStaff } from "./enforce.js";

const WHEN = { key: "when", label: "Posted at: UTC like 2026-10-12 14:30 (or 'now'). Add an offset for local time, e.g. 2026-10-12 17:30+03:00. A future time schedules it." };
const NOTE = { key: "reason", label: "Note (kept in Action History)", optional: true };
const wrapList = (LIST, name, patch) => { const orig = LIST[name]; if (!orig) return; LIST[name] = async (...a) => { const t = await orig(...a); patch(t); return t; }; };
const wrapAct = (ACT, name, handlers) => { const orig = ACT[name]; if (!orig) return; ACT[name] = async (staff, id, a, b) => (handlers[a] ? handlers[a](staff, id, b || {}) : orig(staff, id, a, b)); };

// Make an existing action undoable: snapshot the columns it can change, run it, and write the audit row WITH the snapshot.
const withUndo = (ACT, name, table, cols, kind, actions) => {
  const orig = ACT[name]; if (!orig) return;
  ACT[name] = async (staff, id, a, b = {}) => {
    if (!actions.includes(a)) return orig(staff, id, a, b);
    const prev = await contentDb.prepare(`SELECT ${cols.join(", ")} FROM ${table} WHERE id = ?`).get(id);
    const out = await orig(staff, id, a, b);
    await logStaff(staff, `${name}:${a}`, id, b.reason || b.note || null, prev ? { kind, data: { id, prev } } : null);
    return { ...(out || {}), _audited: true };
  };
};

export function installAdminExtras({ LIST, ACT }) {
  withUndo(ACT, "stories", "stories", ["status", "mod_reason", "moderated_by", "moderated_at", "featured", "noindex", "title", "body", "company_name", "updated_at"], "story_state", ["remove", "restore", "unpublish", "feature", "unfeature", "noindex", "index", "edit"]);
  withUndo(ACT, "moderation", "posts", ["visibility", "mod_reason", "moderated_by", "moderated_at"], "post_state", ["remove", "restore"]);
  withUndo(ACT, "feed", "posts", ["visibility", "mod_reason", "pinned", "cringe_nominated", "moderated_by", "moderated_at"], "post_state", ["unpin", "denominate", "remove"]);
  // ---- stories: set posted time, rename how the author appears ----
  wrapList(LIST, "stories", (t) => {
    t.rows.forEach((r) => { r._form = { ...(r._form || {}), when: r.when, name: r.by }; });
    t.actions.unshift(
      { id: "set_time", label: "Set posted time / publish…", form: [WHEN, NOTE] },
      { id: "rename_author", label: "Change author name…", form: [{ key: "name", label: "How the author's name appears" }, { key: "scope", label: "Apply to", options: [{ value: "story", label: "This story only" }, { value: "author", label: "Every story, post and reply by this author" }] }, NOTE] },
      { id: "suggest_names", label: "Suggest names (AI)" },
    );
  });
  wrapAct(ACT, "stories", {
    set_time: async (staff, id, b) => { const r = await setStoryTime(staff, id, b.when, b.reason); return { _audited: true, message: r.status === "scheduled" ? `Scheduled for ${r.when.slice(0, 16).replace("T", " ")} UTC.` : `Posted as of ${r.when.slice(0, 16).replace("T", " ")} UTC.` }; },
    rename_author: async (staff, id, b) => { const r = await renameAuthor(staff, id, b.name, b.scope === "author" ? "author" : "story", b.reason); return { _audited: true, message: `Now shown as “${r.name}” (${r.changed} item${r.changed === 1 ? "" : "s"}).` }; },
    suggest_names: async (staff, id) => ({ _audited: true, message: "Suggestions:\n• " + (await suggestNames(id)).join("\n• ") + "\n\nCopy one into “Change author name”." }),
  });

  // ---- Pulse posts (Content Moderation) and the Awards board (Pinned & Featured): one timeline for both ----
  for (const sec of ["moderation", "feed"]) {
    wrapList(LIST, sec, (t) => {
      if (sec === "moderation") t.rows.forEach((r) => { r._form = { ...(r._form || {}), when: r.created }; });
      t.actions.push({ id: "set_time", label: "Set posted time…", form: [WHEN, NOTE] });
    });
    wrapAct(ACT, sec, { set_time: async (staff, id, b) => { const r = await setPostTime(staff, id, b.when, b.reason); return { _audited: true, message: `Posted as of ${r.when.slice(0, 16).replace("T", " ")} UTC everywhere (Pulse, Awards${r.linkedStories ? `, ${r.linkedStories} linked stor${r.linkedStories > 1 ? "ies" : "y"}` : ""}).` }; } });
  }

  // ---- Action History & Undo ----
  LIST.history = async () => {
    const rows = await listHistory(300);
    const col = (key, label) => ({ key, label });
    return {
      columns: [col("when", "When"), col("actor", "Who"), col("action", "Action"), col("detail", "Detail"), col("undo", "Undo")],
      rows: rows.map((x) => ({ id: x.id, when: String(x.created_at).slice(0, 19).replace("T", " "), actor: x.pseudonym || String(x.actor_id).slice(0, 8), action: x.action, detail: String(x.detail || "").slice(0, 160), undo: x.undone_at ? `undone ${String(x.undone_at).slice(0, 16).replace("T", " ")}` : x.undo_kind ? "available" : "—" })),
      actions: [{ id: "undo", label: "Undo this action", danger: true, when: { undo: ["available"] } }], summary: [["Can be undone", rows.filter((x) => x.undo_kind && !x.undone_at).length]],
    };
  };
  ACT.history = async (staff, id, a) => { if (a !== "undo") throw Object.assign(new Error("Unknown action."), { status: 400 }); const r = await undoAction(staff, id); return { _audited: true, message: r.summary || "Undone." }; };
}
