import { NextResponse } from "next/server";
import { identityDb } from "@/lib/identity/db";
import { createNotification } from "@/lib/identity/service";
import { ENFORCEMENT_ACTIONS, can, isStaffRole } from "./roles";
import { invalidateSession } from "../session-cache.js";

const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();

export async function logStaff(staff, action, target = null, detail = null) {
  await identityDb.prepare(
    "INSERT INTO staff_audit_log (id, actor_id, actor_role, action, target, detail, created_at) VALUES (?,?,?,?,?,?,?)"
  ).run(uid(), staff.id, staff.role, action, target, detail, now());
}

// Called from lib/session.js for every authenticated request. Lazily lifts
// expired temporary locks/suspensions, so no cron job is needed.
export async function getAccountGate(accountId) {
  const r = await identityDb.prepare("SELECT status, status_until, must_reset_password FROM accounts WHERE id = ?").get(accountId);
  if (!r) return { blocked: false };
  if ((r.status === "locked" || r.status === "suspended") && r.status_until && new Date(r.status_until) <= new Date()) {
    await identityDb.prepare("UPDATE accounts SET status='active', status_until=NULL WHERE id=?").run(accountId);
    return { blocked: false };
  }
  if (r.status === "banned") return { blocked: true, message: "This account has been permanently suspended. You can appeal from the sign-in screen." };
  if (r.status === "suspended") return { blocked: true, message: `This account is suspended until ${r.status_until?.slice(0, 10)}.` };
  if (r.status === "locked") return { blocked: true, message: `This account is temporarily locked until ${r.status_until?.slice(0, 10)}.` };
  if (r.must_reset_password) return { blocked: true, resetRequired: true, message: "A password reset is required before you can continue." };
  return { blocked: false };
}

const CAP_MESSAGES = {
  posting: "Posting is restricted on your account.",
  replies: "Replying is restricted on your account.",
  messaging: "Messaging is restricted on your account.",
  vent_rooms: "Vent Room creation is restricted on your account.",
  company_pages: "Company page creation is restricted on your account.",
};
const CAP_TO_RESTRICTION = { posting: "limit_posting", replies: "limit_replies", messaging: "limit_messaging", vent_rooms: "priv:vent_rooms", company_pages: "priv:company_pages" };

// Route hook: `const blocked = await restrictionError(accountId, "posting"); if (blocked) return blocked;`
export async function restrictionError(accountId, capability) {
  const r = await identityDb.prepare("SELECT restrictions, government_id_status FROM accounts WHERE id = ?").get(accountId);
  if (!r) return null;
  let list = [];
  try { list = JSON.parse(r.restrictions || "[]"); } catch {}
  const needsId = list.includes("require_verification") && r.government_id_status !== "verified" && capability !== "messaging";
  if (needsId) return NextResponse.json({ error: "Verify your identity to continue — a moderator has required it for this account.", code: "VERIFICATION_REQUIRED" }, { status: 403 });
  if (list.includes(CAP_TO_RESTRICTION[capability])) return NextResponse.json({ error: CAP_MESSAGES[capability], code: "ACCOUNT_RESTRICTED" }, { status: 403 });
  return null;
}

export async function accountIdForAnonymousId(anonymousId) {
  const r = await identityDb.prepare("SELECT account_id FROM anonymous_identities WHERE anonymous_id = ?").get(anonymousId);
  return r?.account_id || null;
}

// The single place enforcement is applied — used by the Users page, by
// moderation-queue shortcuts (which pass an account id resolved server-side
// from an anonymous_id, so the moderator never sees whose it was), and by
// appeals when they're accepted.
export async function applyEnforcement(staff, accountId, actionKey, { reason = "", days = 7, privilege = null } = {}) {
  const def = ENFORCEMENT_ACTIONS[actionKey];
  if (!def) throw Object.assign(new Error("Unknown enforcement action."), { status: 400 });
  if (!reason.trim()) throw Object.assign(new Error("A reason is required."), { status: 400 });
  if (def.severe && !can(staff.role, "users.enforce.severe")) throw Object.assign(new Error("Your role can't issue this action."), { status: 403 });
  const acct = await identityDb.prepare("SELECT id, role, restrictions FROM accounts WHERE id = ?").get(accountId);
  if (!acct) throw Object.assign(new Error("No such account."), { status: 404 });
  if (isStaffRole(acct.role) && !can(staff.role, "staff.manage")) throw Object.assign(new Error("Staff accounts can only be actioned by an admin."), { status: 403 });
  if (acct.id === staff.id) throw Object.assign(new Error("You can't enforce against yourself."), { status: 400 });

  const expires = def.timed ? new Date(Date.now() + Math.min(Math.max(+days || 7, 1), 365) * 864e5).toISOString() : null;
  let list = []; try { list = JSON.parse(acct.restrictions || "[]"); } catch {}
  const set = (sql, ...p) => identityDb.prepare(sql).run(...p, accountId);

  if (def.status) await set("UPDATE accounts SET status = ?, status_until = ? WHERE id = ?", def.status, expires);
  else if (def.restriction) {
    const key = def.restriction === "custom" ? `priv:${privilege}` : def.restriction;
    if (def.restriction === "custom" && !["vent_rooms", "company_pages"].includes(privilege)) throw Object.assign(new Error("Pick a privilege: vent_rooms or company_pages."), { status: 400 });
    if (!list.includes(key)) list.push(key);
    await set("UPDATE accounts SET restrictions = ? WHERE id = ?", JSON.stringify(list));
  } else if (actionKey === "require_verification") {
    if (!list.includes("require_verification")) list.push("require_verification");
    await set("UPDATE accounts SET restrictions = ? WHERE id = ?", JSON.stringify(list));
  } else if (actionKey === "label") await set("UPDATE accounts SET account_label = ? WHERE id = ?", reason.slice(0, 80));
  else if (actionKey === "force_password_reset") await set("UPDATE accounts SET must_reset_password = 1 WHERE id = ?");
  else if (actionKey === "force_email_verification") await set("UPDATE accounts SET email_verified = 0 WHERE id = ?");
  else if (actionKey === "force_phone_verification") await set("UPDATE accounts SET phone_verified = 0 WHERE id = ?");
  else if (actionKey === "remove_verification") await set("UPDATE accounts SET government_id_status='none', business_verified_status='none', professional_verified_status='none' WHERE id = ?");
  else if (actionKey === "restore") {
    await set("UPDATE accounts SET status='active', status_until=NULL, restrictions='[]', account_label=NULL, must_reset_password=0 WHERE id = ?");
    await identityDb.prepare("UPDATE enforcements SET revoked_at = ?, revoked_by = ? WHERE account_id = ? AND revoked_at IS NULL").run(now(), staff.id, accountId);
  }

  invalidateSession(accountId); // bans / restores take effect on the very next request, not after the 5s cache
  const id = uid();
  await identityDb.prepare("INSERT INTO enforcements (id, account_id, action, reason, issued_by, expires_at, created_at) VALUES (?,?,?,?,?,?,?)")
    .run(id, accountId, actionKey, reason, staff.pseudonym || staff.id, expires, now());
  await logStaff(staff, `enforce:${actionKey}`, accountId, reason);
  if (actionKey !== "label") {
    await createNotification(accountId, "enforcement", `${def.label}: ${reason}${def.status ? " You can appeal from the sign-in screen." : ""}`).catch(() => {});
  }
  return { id };
}

// ---- Activity tracking (feeds Online now / DAU / MAU in the Command Center) ----
// Fire-and-forget and throttled in-process: at most one last_seen_at write per
// account per minute, and one daily_active insert per account per day.
const seen = new Map(); const dayDone = new Set();
export function recordActivity(accountId) {
  const t = Date.now();
  if ((seen.get(accountId) || 0) > t - 60000) return;
  seen.set(accountId, t);
  if (seen.size > 5000) seen.clear();
  const iso = new Date(t).toISOString();
  identityDb.prepare("UPDATE accounts SET last_seen_at = ? WHERE id = ?").run(iso, accountId).catch(() => {});
  const key = accountId + iso.slice(0, 10);
  if (!dayDone.has(key)) {
    dayDone.add(key); if (dayDone.size > 20000) dayDone.clear();
    identityDb.prepare("INSERT INTO daily_active (account_id, day) VALUES (?, ?) ON CONFLICT DO NOTHING").run(accountId, iso.slice(0, 10)).catch(() => {});
  }
}
