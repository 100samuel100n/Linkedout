// THE KILL SWITCH. "Revoke" used to mean "this copy must register again", and a genuine APK could simply do that, so nothing
// really stopped. A kill is different and permanent until an admin undoes it:
//   1. the install row becomes status 'killed' (verifyRequest, the session gate and the edge proxy refuse it in EVERY mode, even 'off')
//   2. its DEVICE is blocked (dist_blocked_devices), so reinstalling or re-registering on the same phone is refused too
//   3. its account sessions are dropped; optionally the account is suspended
//   4. a silent push tells the app to wipe itself now; the app also learns it from any API answer, the gate, or its licence lease
//   5. the app stores a local tombstone, wipes its data and keys, and shows only a lock screen (native lib/killswitch.js)
//   6. the licence lease (signed, short-lived) is never issued again, so an offline copy dies when its lease expires
// Whole releases are killed the same way (without the device block), and the version code is withdrawn so it can't register again.
// Everything is written to the audit log with a snapshot so Undo (Admin -> Action History) restores it exactly.
import { identityDb } from "@/lib/identity/db";
import { distReady, settings, logEvent, now, bad } from "./db.js";
import { signPayload } from "./sign.js";
import { logStaff } from "@/lib/admin/enforce";
import { registerUndo } from "@/lib/admin/history.js";

export const DEV_RE = /^[0-9a-f]{64}$/;
export const cleanDevHash = (v) => (DEV_RE.test(String(v || "")) ? String(v) : null);

// ---- small caches (5-10 s) so the hot path never waits on the database ----
let blocked = { at: 0, set: new Set() }, gone = { at: 0, set: new Set() };
export async function blockedDevices() {
  if (Date.now() - blocked.at < 5000) return blocked.set;
  await distReady();
  blocked = { at: Date.now(), set: new Set((await identityDb.prepare("SELECT device_hash FROM dist_blocked_devices LIMIT 20000").all()).map((r) => r.device_hash)) };
  return blocked.set;
}
export async function withdrawnCodes() {
  if (Date.now() - gone.at < 10000) return gone.set;
  await distReady();
  gone = { at: Date.now(), set: new Set((await identityDb.prepare("SELECT version_code FROM dist_withdrawn").all()).map((r) => +r.version_code)) };
  return gone.set;
}
export const resetKillCaches = () => { blocked.at = 0; gone.at = 0; };
export const isDeviceBlocked = async (h) => !!h && (await blockedDevices()).has(h);
export const isVersionWithdrawn = async (code) => !!code && (await withdrawnCodes()).has(+code);

async function afterChange(installIds) {
  resetKillCaches();
  const { forgetInstall } = await import("./installs.js"); installIds.forEach(forgetInstall);
  const { bumpRevocations } = await import("./revocations.js"); bumpRevocations();
}

// Silent "wipe yourself" push. The payload names the install, and an app ignores a kill that isn't for its own install id, so it is
// safe to send to every device on the account. Best effort only: the real guarantees are the server refusals and the licence lease.
async function pushKill(accountId, installId, reason) {
  if (!accountId) return;
  try {
    const { sendPushToTokens } = await import("@/lib/push");
    const toks = (await identityDb.prepare("SELECT token FROM push_tokens WHERE account_id = ? AND (platform IS NULL OR platform <> 'web')").all(accountId)).map((t) => t.token);
    if (toks.length) await sendPushToTokens(toks, { data: { type: "kill", installId, reason: String(reason || "").slice(0, 120), wipe: true }, category: "security", wake: true, sound: { enabled: false } });
  } catch (e) { console.error("[kill] push failed:", e?.message); }
}

async function killOne(staff, row, reason, { blockDevice }) {
  const prev = { install_id: row.install_id, status: row.status, revoke_reason: row.revoke_reason, revoked_at: row.revoked_at, revoked_by: row.revoked_by, device_hash: row.device_hash, deviceBlockedByUs: false };
  await identityDb.prepare("UPDATE dist_installs SET status = 'killed', kill_reason = ?, killed_at = ?, killed_by = ?, revoke_reason = ?, revoked_at = ?, revoked_by = ? WHERE install_id = ?")
    .run(String(reason).slice(0, 300), now(), staff?.id || "system", String(reason).slice(0, 300), now(), staff?.id || "system", row.install_id);
  if (blockDevice && row.device_hash) {
    const had = await identityDb.prepare("SELECT 1 x FROM dist_blocked_devices WHERE device_hash = ?").get(row.device_hash);
    if (!had) { await identityDb.prepare("INSERT INTO dist_blocked_devices (device_hash, install_id, account_id, reason, created_by, created_at) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING").run(row.device_hash, row.install_id, row.account_id || null, String(reason).slice(0, 300), staff?.id || "system", now()); prev.deviceBlockedByUs = true; }
  }
  await logEvent("kill", { installId: row.install_id, versionCode: row.version_code, detail: { by: staff?.id || "system", reason, blockDevice: !!blockDevice } });
  return prev;
}

// Single install: full kill. blockAccountDays > 0 also suspends the linked account (existing enforcement system).
export async function killInstall(staff, installId, reason, { blockDevice = true, blockAccountDays = 0 } = {}) {
  await distReady();
  const row = await identityDb.prepare("SELECT * FROM dist_installs WHERE install_id = ?").get(installId);
  if (!row) throw bad("No such install.", 404);
  if (row.status === "killed") throw bad("This install is already killed.", 409);
  const prev = await killOne(staff, row, reason, { blockDevice });
  await afterChange([installId]);
  if (row.account_id) {
    const { invalidateSession } = await import("@/lib/session-cache"); invalidateSession(row.account_id);
    if (blockAccountDays > 0) { const { applyEnforcement } = await import("@/lib/admin/enforce"); await applyEnforcement(staff, row.account_id, "temp_suspend", { reason: `App integrity abuse: ${reason}`, days: blockAccountDays }); }
  }
  pushKill(row.account_id, installId, reason);
  await logStaff(staff || { id: "system", role: "system" }, "install:kill", installId, `${reason}${prev.deviceBlockedByUs ? " · device blocked" : ""}${blockAccountDays ? ` · account suspended ${blockAccountDays}d` : ""}`, { kind: "install", data: { installs: [prev], accountSuspended: blockAccountDays > 0 ? row.account_id : null } });
  return { ok: true, deviceBlocked: prev.deviceBlockedByUs };
}

// Every active/revoked install on a version (release withdrawn or deleted). Devices are NOT blocked, so people can install the next official build.
export async function killByVersion(staff, versionCode, reason) {
  await distReady();
  const rows = await identityDb.prepare("SELECT * FROM dist_installs WHERE version_code = ? AND status <> 'killed' LIMIT 5000").all(versionCode);
  const prevs = []; for (const r of rows) prevs.push(await killOne(staff, r, reason, { blockDevice: false }));
  await afterChange(rows.map((r) => r.install_id));
  const { invalidateSession } = await import("@/lib/session-cache");
  for (const r of rows) { if (r.account_id) invalidateSession(r.account_id); pushKill(r.account_id, r.install_id, reason); }
  if (prevs.length) await logStaff(staff || { id: "system", role: "system" }, "install:kill_version", String(versionCode), `${prevs.length} installs · ${reason}`, { kind: "install", data: { installs: prevs } });
  return prevs.length;
}

// Undo: restores exactly what each row was, and lifts only the device blocks this kill created.
registerUndo("install", async (staff, data) => {
  await distReady(); let n = 0;
  for (const p of data.installs || []) {
    await identityDb.prepare("UPDATE dist_installs SET status = ?, revoke_reason = ?, revoked_at = ?, revoked_by = ?, kill_reason = NULL, killed_at = NULL, killed_by = NULL WHERE install_id = ?").run(p.status, p.revoke_reason, p.revoked_at, p.revoked_by, p.install_id);
    if (p.deviceBlockedByUs && p.device_hash) await identityDb.prepare("DELETE FROM dist_blocked_devices WHERE device_hash = ?").run(p.device_hash);
    n++;
  }
  if (data.accountSuspended) { try { const { applyEnforcement } = await import("@/lib/admin/enforce"); await applyEnforcement(staff, data.accountSuspended, "restore", { reason: "Install kill undone" }); } catch { /* already lifted */ } }
  await afterChange((data.installs || []).map((p) => p.install_id));
  return `Restored ${n} install(s). The phone must open the app online, register again and sign in.`;
});

// Settings changes made from the policy screen can be undone too.
registerUndo("setting", async (staff, data) => {
  const { putSetting } = await import("./db.js");
  await putSetting(staff, data.key, data.prev ?? "", { bump: true }); return `Setting ${data.key} restored`;
});

// ---------------------------------------------------------------- licence lease
// A short, signed permission slip. The app keeps the last one and refuses to open without a valid one (when the server says leases are
// required). A killed install gets a signed kill order instead, which the app can verify offline-safe (public key compiled in).
export async function leaseFor(installId, { verified }) {
  await distReady(); const s = await settings();
  const row = installId ? await identityDb.prepare("SELECT install_id, status, version_code, device_hash, kill_reason FROM dist_installs WHERE install_id = ?").get(installId) : null;
  if (!row) return { env: null, unknown: true };
  const t = Date.now(); const base = { v: 1, installId, issuedAt: t, serverTime: t };
  if (row.status === "killed" || (await isVersionWithdrawn(row.version_code)) || (await isDeviceBlocked(row.device_hash))) {
    const why = row.kill_reason || ((await isVersionWithdrawn(row.version_code)) ? "This version has been withdrawn." : "This device has been disabled.");
    return { env: signPayload({ ...base, status: "killed", wipe: true, reason: why }) };
  }
  if (row.status !== "active") return { env: signPayload({ ...base, status: "revoked", wipe: false }) };
  if (!verified) return { env: null, needSignature: true };
  const ttl = Math.min(43200, Math.max(15, +s.lease_ttl_minutes || 1440)) * 60000;
  return { env: signPayload({ ...base, status: "ok", expiresAt: t + ttl, requireLease: s.require_lease === "1" }) };
}

// Direct restore for a killed install when no audit snapshot is at hand (Undo in Action History is preferred).
export async function restoreKilled(staff, installId) {
  await distReady();
  const r = await identityDb.prepare("UPDATE dist_installs SET status = 'active', kill_reason = NULL, killed_at = NULL, killed_by = NULL, revoke_reason = NULL, revoked_at = NULL WHERE install_id = ? AND status = 'killed'").run(installId);
  if (!r.changes) throw bad("That install is not killed.", 404);
  await identityDb.prepare("DELETE FROM dist_blocked_devices WHERE install_id = ?").run(installId);
  await afterChange([installId]); await logEvent("restore", { installId, detail: { by: staff?.id } });
}

registerUndo("pwa", async (staff, data) => {
  await distReady();
  await identityDb.prepare("UPDATE dist_pwa SET status = ?, kill_reason = NULL WHERE device_id = ?").run(data.prev || "active", data.id);
  return "Web app restored";
});
