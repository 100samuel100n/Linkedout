// Admin action history + undo.
//   * Every staff action is already written to staff_audit_log (lib/admin/enforce.js -> logStaff).
//   * An action that can be reversed passes `undo: { kind, data }` to logStaff. `data` holds the exact previous state
//     (a snapshot, never a guess), so Undo restores what was there, not an approximation.
//   * undoAction() runs the handler registered for that kind, marks the row undone (once only) and writes its own audit row.
// Handlers live next to the code that owns the data and are loaded lazily by kind (LOADERS below).
import { identityDb } from "@/lib/identity/db";

const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const handlers = new Map();
export const registerUndo = (kind, fn) => handlers.set(kind, fn);

const LOADERS = {
  time: () => import("./timeline.js"),
  alias: () => import("./aliases.js"),
  install: () => import("@/lib/distribution/kill.js"),
  setting: () => import("@/lib/distribution/kill.js"),
  pwa: () => import("@/lib/distribution/kill.js"),
  story_state: () => import("./timeline.js"),
  post_state: () => import("./timeline.js"),
};

let cols = false;
export async function ensureUndoCols() {
  if (cols) return;
  for (const c of ["undo_kind TEXT", "undo_data TEXT", "undone_at TEXT", "undone_by TEXT"]) await identityDb.prepare(`ALTER TABLE staff_audit_log ADD COLUMN IF NOT EXISTS ${c}`).run();
  cols = true;
}

export async function listHistory(limit = 300) {
  await ensureUndoCols();
  return identityDb.prepare("SELECT l.id, l.actor_id, l.actor_role, l.action, l.target, l.detail, l.created_at, l.undo_kind, l.undone_at, a.pseudonym, u.pseudonym AS undone_by_name FROM staff_audit_log l LEFT JOIN accounts a ON a.id = l.actor_id LEFT JOIN accounts u ON u.id = l.undone_by ORDER BY l.created_at DESC LIMIT ?").all(limit);
}

export async function undoAction(staff, auditId) {
  await ensureUndoCols();
  const row = await identityDb.prepare("SELECT * FROM staff_audit_log WHERE id = ?").get(auditId);
  if (!row) throw bad("No such action.", 404);
  if (!row.undo_kind) throw bad("This action can't be undone automatically.");
  if (row.undone_at) throw bad("This action was already undone.");
  if (!handlers.has(row.undo_kind) && LOADERS[row.undo_kind]) await LOADERS[row.undo_kind]();
  const fn = handlers.get(row.undo_kind);
  if (!fn) throw bad("This kind of action can't be undone any more.");
  let data = {}; try { data = JSON.parse(row.undo_data || "{}"); } catch { /* empty */ }
  // Claim first (atomic): two admins pressing Undo at once must not both run it.
  const claim = await identityDb.prepare("UPDATE staff_audit_log SET undone_at = ?, undone_by = ? WHERE id = ? AND undone_at IS NULL").run(new Date().toISOString(), staff.id, auditId);
  if (!claim.changes) throw bad("This action was already undone.");
  try {
    const summary = await fn(staff, data, row);
    const { logStaff } = await import("@/lib/admin/enforce");
    await logStaff(staff, `undo:${row.action}`, row.target, summary || `Reversed action ${String(auditId).slice(0, 8)}`);
    return { ok: true, summary };
  } catch (e) {
    await identityDb.prepare("UPDATE staff_audit_log SET undone_at = NULL, undone_by = NULL WHERE id = ?").run(auditId); // failed: leave it undoable
    throw e;
  }
}
