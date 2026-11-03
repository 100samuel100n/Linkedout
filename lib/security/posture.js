// MDM-style device posture. The native app reports its own health (rooted/jailbroken, emulator, debuggable build,
// OS and app version, screen lock). Staff using a non-compliant device are refused by the admin API and an alert is
// raised. For fleet-level control (remote wipe, app allow-lists) pair this with a real MDM product; this gives you
// compliance gating inside the app without one.
import { identityDb } from "@/lib/identity/db";
let ready = null;
async function init() { if (!ready) ready = identityDb.exec("CREATE TABLE IF NOT EXISTS sec_posture (device_id TEXT NOT NULL, account_id TEXT NOT NULL, platform TEXT, os TEXT, app_version TEXT, rooted INTEGER, emulator INTEGER, debug INTEGER, screen_lock INTEGER, compliant INTEGER NOT NULL, reasons TEXT, seen_at TEXT NOT NULL, PRIMARY KEY (device_id, account_id))").catch((e) => { ready = null; throw e; }); return ready; }
export function evaluate(p) {
  const reasons = [];
  if (p.rooted) reasons.push("device is rooted or jailbroken");
  if (p.emulator) reasons.push("running on an emulator");
  if (p.debug) reasons.push("debuggable build");
  if (p.screenLock === false) reasons.push("no screen lock set");
  const min = process.env.MIN_APP_VERSION;
  if (min && p.appVersion && p.appVersion.localeCompare(min, undefined, { numeric: true }) < 0) reasons.push(`app older than ${min}`);
  return { compliant: reasons.length === 0, reasons };
}
export async function report(accountId, deviceId, p) {
  await init();
  const ev = evaluate(p);
  await identityDb.prepare(`INSERT INTO sec_posture (device_id, account_id, platform, os, app_version, rooted, emulator, debug, screen_lock, compliant, reasons, seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT (device_id, account_id) DO UPDATE SET platform=excluded.platform, os=excluded.os, app_version=excluded.app_version, rooted=excluded.rooted, emulator=excluded.emulator, debug=excluded.debug, screen_lock=excluded.screen_lock, compliant=excluded.compliant, reasons=excluded.reasons, seen_at=excluded.seen_at`)
    .run(String(deviceId).slice(0, 64), accountId, String(p.platform || "").slice(0, 12), String(p.os || "").slice(0, 24), String(p.appVersion || "").slice(0, 16), p.rooted ? 1 : 0, p.emulator ? 1 : 0, p.debug ? 1 : 0, p.screenLock === false ? 0 : 1, ev.compliant ? 1 : 0, JSON.stringify(ev.reasons), new Date().toISOString());
  if (!ev.compliant) {
    const staff = await identityDb.prepare("SELECT role FROM accounts WHERE id = ?").get(accountId);
    if (staff && staff.role !== "user") { const core = await import("./core"); await core.raiseAlert({ type: "policy_deviation", subject: `device:${deviceId}`, accountId, subjectKind: "account", detail: { device: deviceId, nonCompliant: ev.reasons }, dedupeMin: 240 }); }
  }
  return ev;
}
export async function staffDeviceOk(accountId, deviceId) {
  if (!deviceId) return true; // web sessions have no posture; native sends X-Lo-Device
  await init();
  const r = await identityDb.prepare("SELECT compliant, reasons FROM sec_posture WHERE device_id = ? AND account_id = ?").get(String(deviceId).slice(0, 64), accountId);
  if (!r) return process.env.POSTURE_STRICT === "true" ? "This device hasn't reported its security status yet. Open the app and try again." : true;
  return r.compliant ? true : `This device isn't compliant (${JSON.parse(r.reasons).join(", ")}). Staff access is blocked from it.`;
}
export async function listPosture() { await init(); return (await identityDb.prepare("SELECT p.*, a.pseudonym FROM sec_posture p LEFT JOIN accounts a ON a.id = p.account_id ORDER BY p.seen_at DESC LIMIT 100").all()).map((r) => ({ device: r.device_id.slice(0, 8), who: r.pseudonym, platform: r.platform, os: r.os, app: r.app_version, compliant: !!r.compliant, reasons: JSON.parse(r.reasons || "[]"), seenAt: r.seen_at })); }
