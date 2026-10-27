// Database-backed RBAC. Built-in roles are seeded once from lib/admin/roles.js and can then be edited;
// custom roles and custom permissions live beside them. Everything that asks "can this role do X?"
// (API guard, admin sections, native admin, plan perks) reads the same live map, so one edit
// here is reflected everywhere within seconds.
import { identityDb } from "@/lib/identity/db";
import { ROLES, setLiveRoles } from "@/lib/admin/roles";
import { BASE_PERMISSIONS, generatedPermissions, groupOfBase } from "@/lib/admin/permissions-catalog";

const TIERS = ["", "basic", "plus", "pro"];
const KEY = /^[a-z][a-z0-9_]{1,31}$/;
let ready = null, loadedAt = 0, loading = null, loadedOnce = false;
const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });

async function init() {
  if (!ready) ready = (async () => {
    await identityDb.exec(`CREATE TABLE IF NOT EXISTS rbac_roles (
      key TEXT PRIMARY KEY, label TEXT NOT NULL, description TEXT, permissions TEXT NOT NULL DEFAULT '[]', plan_tier TEXT NOT NULL DEFAULT '',
      is_system INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rbac_permissions (key TEXT PRIMARY KEY, label TEXT NOT NULL, group_name TEXT NOT NULL DEFAULT 'Custom', description TEXT, created_by TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rbac_changes (id TEXT PRIMARY KEY, actor_id TEXT, role_key TEXT, change TEXT, created_at TEXT NOT NULL);`);
    const now = new Date().toISOString();
    for (const [key, perms] of Object.entries(ROLES)) {
      if (key === "user") continue;
      const label = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      const locked = key === "super_admin" ? 1 : 0;
      await identityDb.prepare("INSERT INTO rbac_roles (key,label,description,permissions,plan_tier,is_system,locked,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT (key) DO NOTHING")
        .run(key, label, "Built-in role", JSON.stringify(perms), key === "admin" || key === "super_admin" ? "pro" : "", 1, locked, now, now);
    }
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

export async function refreshRoles() {
  await init();
  const rows = await identityDb.prepare("SELECT * FROM rbac_roles").all();
  const map = {};
  for (const r of rows) { let p = []; try { p = JSON.parse(r.permissions); } catch {} map[r.key] = { perms: p, planTier: r.plan_tier || "", label: r.label }; }
  setLiveRoles(map); loadedAt = Date.now();
  return map;
}
// Cheap to call on every request: at most one refresh per 10 s per instance. Never throws (falls back to built-ins).
export async function ensureRolesFresh() {
  if (Date.now() - loadedAt < 10000) return;
  import("@/lib/security/core").then((m) => m.sweepExpired()).catch(() => {});
  if (!loading) loading = refreshRoles().catch((e) => console.error("[rbac] refresh failed:", e?.message)).finally(() => { loading = null; loadedAt = Date.now(); });
  // Only the very first load on a cold instance is awaited; later refreshes happen in the background.
  if (!loadedOnce) { await loading; loadedOnce = true; }
}

export async function permissionCatalog() {
  await init();
  const custom = await identityDb.prepare("SELECT * FROM rbac_permissions ORDER BY group_name, key").all();
  const all = {};
  for (const [k, label] of Object.entries(BASE_PERMISSIONS)) all[k] = { label, group: groupOfBase(k), kind: "core" };
  for (const [k, v] of Object.entries(generatedPermissions())) if (!all[k]) all[k] = { ...v, kind: "resource" };
  for (const c of custom) all[c.key] = { label: c.label, group: c.group_name, kind: "custom", description: c.description };
  return all;
}

export async function listRoles() {
  await init();
  const rows = await identityDb.prepare("SELECT * FROM rbac_roles ORDER BY is_system DESC, key").all();
  const counts = await identityDb.prepare("SELECT role, COUNT(*) c FROM accounts WHERE role <> 'user' GROUP BY role").all();
  const n = Object.fromEntries(counts.map((c) => [c.role, +c.c]));
  return rows.map((r) => { let p = []; try { p = JSON.parse(r.permissions); } catch {} return { key: r.key, label: r.label, description: r.description || "", permissions: p, planTier: r.plan_tier || "", system: !!r.is_system, locked: !!r.locked, members: n[r.key] || 0, updatedAt: r.updated_at }; });
}

async function log(staff, roleKey, change) {
  await identityDb.prepare("INSERT INTO rbac_changes (id, actor_id, role_key, change, created_at) VALUES (?,?,?,?,?)").run(crypto.randomUUID(), staff.id, roleKey, change.slice(0, 1000), new Date().toISOString());
  try { const { logStaff } = await import("@/lib/admin/enforce"); await logStaff(staff, "rbac", roleKey, change.slice(0, 500)); } catch {}
}
function cleanPerms(list, catalog) {
  const out = [...new Set((Array.isArray(list) ? list : []).map(String))];
  for (const p of out) if (p !== "*" && p !== "*admin" && !catalog[p]) throw bad(`Unknown permission "${p}".`);
  return out;
}
function guardSuper(staff, perms) {
  if ((perms.includes("*") || perms.includes("*admin")) && staff.role !== "super_admin") throw bad("Only a super admin can grant full access.", 403);
}

export async function saveRole(staff, input) {
  await init();
  await (await import("@/lib/security/core")).assertRoleChangesAllowed();
  const catalog = await permissionCatalog();
  const key = String(input.key || "").trim().toLowerCase();
  const existing = await identityDb.prepare("SELECT * FROM rbac_roles WHERE key = ?").get(key);
  const perms = cleanPerms(input.permissions, catalog);
  guardSuper(staff, perms);
  const planTier = TIERS.includes(input.planTier || "") ? input.planTier || "" : (() => { throw bad("Plan must be basic, plus, pro or none."); })();
  const now = new Date().toISOString();
  if (existing) {
    if (existing.locked) throw bad("This role is locked and can't be changed.", 403);
    if (staff.role === key && !perms.includes("roles.manage") && !perms.includes("*")) throw bad("You can't remove your own role-management access.");
    await identityDb.prepare("UPDATE rbac_roles SET label=?, description=?, permissions=?, plan_tier=?, updated_at=? WHERE key=?")
      .run(String(input.label || existing.label).slice(0, 60), String(input.description ?? existing.description ?? "").slice(0, 300), JSON.stringify(perms), planTier, now, key);
    await log(staff, key, `updated: ${perms.length} permissions, plan ${planTier || "none"}`);
  } else {
    if (!KEY.test(key) || key === "user") throw bad("Role key: lowercase letters, numbers and underscores, 2–32 characters, starting with a letter.");
    await identityDb.prepare("INSERT INTO rbac_roles (key,label,description,permissions,plan_tier,is_system,locked,created_by,created_at,updated_at) VALUES (?,?,?,?,?,0,0,?,?,?)")
      .run(key, String(input.label || key).slice(0, 60), String(input.description || "").slice(0, 300), JSON.stringify(perms), planTier, staff.id, now, now);
    await log(staff, key, `created with ${perms.length} permissions`);
  }
  await refreshRoles();
  if (perms.includes("*") || perms.includes("*admin") || perms.includes("roles.manage") || perms.includes("staff.manage")) (await import("@/lib/security/core")).notePrivilegeChange(staff, { target: `role:${key}`, change: "role granted powerful permissions" }).catch(() => {});
  return { ok: true };
}

export async function deleteRole(staff, key) {
  await init();
  const r = await identityDb.prepare("SELECT * FROM rbac_roles WHERE key = ?").get(key);
  if (!r) throw bad("No such role.", 404);
  if (r.is_system) throw bad("Built-in roles can't be deleted (edit them instead).", 403);
  const used = await identityDb.prepare("SELECT COUNT(*) c FROM accounts WHERE role = ?").get(key);
  if (+used.c) throw bad(`${used.c} account(s) still hold this role. Move them to another role first.`, 409);
  await identityDb.prepare("DELETE FROM rbac_roles WHERE key = ?").run(key);
  await log(staff, key, "deleted"); await refreshRoles();
  return { ok: true };
}

export async function addPermission(staff, input) {
  await init();
  const key = String(input.key || "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$/.test(key)) throw bad("Permission key looks like resource.action (e.g. report.escalate).");
  const catalog = await permissionCatalog();
  if (catalog[key]) throw bad("That permission already exists.", 409);
  await identityDb.prepare("INSERT INTO rbac_permissions (key,label,group_name,description,created_by,created_at) VALUES (?,?,?,?,?,?)")
    .run(key, String(input.label || key).slice(0, 80), String(input.group || "Custom").slice(0, 40), String(input.description || "").slice(0, 200), staff.id, new Date().toISOString());
  await log(staff, key, "permission added");
  return { ok: true };
}
export async function deletePermission(staff, key) {
  await init();
  const r = await identityDb.prepare("DELETE FROM rbac_permissions WHERE key = ?").run(key);
  if (!r.changes) throw bad("Only custom permissions can be deleted.", 404);
  for (const role of await listRoles()) if (role.permissions.includes(key)) await identityDb.prepare("UPDATE rbac_roles SET permissions=? WHERE key=?").run(JSON.stringify(role.permissions.filter((p) => p !== key)), role.key);
  await log(staff, key, "permission deleted"); await refreshRoles();
  return { ok: true };
}
export async function roleKeys() { await init(); return (await identityDb.prepare("SELECT key FROM rbac_roles ORDER BY is_system DESC, key").all()).map((r) => r.key); }
