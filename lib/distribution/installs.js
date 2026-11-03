// Per-install identity. Every genuine copy of the app proves itself once (hardware key attestation, see attest.js) and
// from then on signs its requests with a key that never leaves the phone's secure hardware.
//
//   register  ->  server issues install_id, stores the PUBLIC key
//   each call ->  X-Lo-Install / X-Lo-Ts / X-Lo-Nonce / X-Lo-Sig   (signature also covers a hash of the session token,
//                 so a stolen token is useless without the phone's key)
//   revoke    ->  status='revoked': that copy stops working immediately and must register again. A fake cannot, because it
//                 cannot obtain an attestation naming our package and signing certificate.
import crypto from "node:crypto";
import { identityDb } from "@/lib/identity/db";
import { canonicalJson, sha256Hex, fromB64u, b64u, normHex } from "./canon.js";
import { verifyAttestation, parseRoots } from "./attest.js";
import { distReady, settings, officialCerts, logEvent, hashIp, now, uid, bad, J, P } from "./db.js";
import { cleanDevHash, isDeviceBlocked, isVersionWithdrawn, killInstall, killByVersion } from "./kill.js";
import { buildDetails, cleanPrecise } from "./details.js";

const TRUST_RANK = { none: 0, software: 1, hardware: 2 };
export const SKEW_MS = 5 * 60 * 1000;

let roots = null;
const attestRoots = () => (roots ??= parseRoots(process.env.DIST_ATTEST_ROOTS || ""));

// ---------------------------------------------------------------- challenges
export async function createChallenge(ip) {
  await distReady();
  const raw = crypto.randomBytes(32);
  await identityDb.prepare("INSERT INTO dist_challenges (id, ip_hash, created_at, expires_at) VALUES (?,?,?,?)").run(sha256Hex(raw), hashIp(ip), now(), new Date(Date.now() + 5 * 60000).toISOString());
  identityDb.prepare("DELETE FROM dist_challenges WHERE expires_at < ?").run(new Date(Date.now() - 3600000).toISOString()).catch?.(() => {});
  return { challenge: b64u(raw), expiresInSec: 300 };
}
async function consumeChallenge(b64) {
  const raw = fromB64u(b64); if (raw.length !== 32) return null;
  const r = await identityDb.prepare("UPDATE dist_challenges SET used = 1 WHERE id = ? AND used = 0 AND expires_at > ?").run(sha256Hex(raw), now());
  return r.changes ? raw : null;
}

// ---------------------------------------------------------------- registration
// Returns { installId, trust, gate } or throws a status error whose message is safe to show.
export async function registerInstall({ body, ip, country, headers = null }) {
  await distReady();
  const s = await settings();
  const { alertFailure } = await import("./detect.js");
  const versionCode = Math.max(0, Math.round(+body?.versionCode || 0));
  const meta = { versionCode, channel: String(body?.channel || "").slice(0, 24), device: { model: String(body?.device?.model || "").slice(0, 40), sdk: +body?.device?.sdk || null } };
  const refuse = async (reason, detail = {}) => { await logEvent("attest_fail", { versionCode, ip, country, detail: { reason, ...detail, device: meta.device } }); await alertFailure({ reason, ip, versionCode, detail }); throw bad("This copy of the app could not be verified. Install LinkedOut from linkedoutnetwork.com/install.", 403); };

  // A killed device or a withdrawn version can never come back by re-registering (this is what made "revoke" toothless before).
  const devHash = cleanDevHash(body?.devHash);
  if (devHash && (await isDeviceBlocked(devHash))) { await logEvent("register_refused", { versionCode, ip, country, detail: { reason: "device killed" } }); throw Object.assign(bad("This device has been disabled.", 403), { code: "INSTALL_KILLED" }); }
  if (await isVersionWithdrawn(versionCode)) { await logEvent("register_refused", { versionCode, ip, country, detail: { reason: "version withdrawn" } }); throw Object.assign(bad("This version of the app has been withdrawn. Install the latest official version.", 403), { code: "VERSION_WITHDRAWN" }); }

  const challenge = await consumeChallenge(body?.challenge);
  if (!challenge) return refuse("challenge expired or reused");
  const chain = Array.isArray(body?.chain) ? body.chain.slice(0, 8).map(String) : [];
  const allowed = await officialCerts();
  let att = verifyAttestation({ chain, challenge, expectedPackage: s.package_name, allowedCertDigests: allowed, roots: attestRoots() });

  // Software-only key (no attestation extension): only acceptable when the app-reported certificate matches AND the key
  // proves possession by signing our challenge. This path is spoofable by a determined attacker, so it is capped at trust "software".
  if (!att.ok && att.softwareOnly) {
    const reported = normHex(body?.certSha256);
    const proofOk = (() => { try { return crypto.verify("sha256", challenge, { key: crypto.createPublicKey({ key: Buffer.from(att.publicKeyDer, "base64"), format: "der", type: "spki" }), dsaEncoding: "der" }, fromB64u(body?.proof)); } catch { return false; } })();
    if (proofOk && allowed.includes(reported) && String(body?.packageName) === s.package_name) att = { ok: true, level: "software", reasons: ["no hardware attestation available on this device"], pkg: s.package_name, certDigests: [reported], publicKeyDer: att.publicKeyDer, bootState: "unknown" };
  }
  if (!att.ok) return refuse(att.reasons[0] || "attestation failed", { pkg: att.pkg, certDigests: att.certDigests });

  // proof of possession for the hardware path too
  try {
    const okSig = crypto.verify("sha256", challenge, { key: crypto.createPublicKey({ key: Buffer.from(att.publicKeyDer, "base64"), format: "der", type: "spki" }), dsaEncoding: "der" }, fromB64u(body?.proof));
    if (!okSig) return refuse("key proof failed");
  } catch { return refuse("key proof failed"); }

  if (s.mode === "enforce" && TRUST_RANK[att.level] < TRUST_RANK[s.min_trust]) return refuse(`trust level ${att.level} below required ${s.min_trust}`, { level: att.level });
  const flags = { reasons: att.reasons, integrity: body?.integrity && typeof body.integrity === "object" ? Object.fromEntries(Object.entries(body.integrity).slice(0, 12).map(([k, v]) => [String(k).slice(0, 24), !!v])) : {} };
  const id = uid();
  const det = await buildDetails(headers || { get: () => "" }, ip).catch(() => ({}));
  const hw = J(Object.fromEntries(Object.entries(body?.hw && typeof body.hw === "object" ? body.hw : {}).slice(0, 20).map(([k, v]) => [String(k).slice(0, 24), typeof v === "number" ? v : String(v).slice(0, 80)])));
  await identityDb.prepare(`INSERT INTO dist_installs (install_id, public_key, platform, version_name, version_code, channel, installer, cert_sha256, trust, attest, device, status, country, ip_hash, flags, first_seen, last_seen, device_hash, ip_enc, geo, precise, hw)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, att.publicKeyDer, "android", String(body?.versionName || "").slice(0, 24), versionCode, meta.channel, String(body?.installer || "").slice(0, 80), att.certDigests[0] || null, att.level,
      J({ boot: att.bootState, locked: att.deviceLocked, securityLevel: att.securityLevel, patch: att.osPatchLevel, os: att.osVersion }), J(meta.device), "active", country || null, hashIp(ip), J(flags), now(), now(), devHash, det.ip_enc || null, det.geo || null, cleanPrecise(body?.precise), hw);
  await logEvent("install_register", { installId: id, versionCode, channel: meta.channel, ip, country, detail: { trust: att.level } });
  const { noteVersion } = await import("./detect.js"); await noteVersion(versionCode, id);
  return { installId: id, trust: att.level, serverTime: Date.now(), gate: await gateFor(id, versionCode) };
}

// ---------------------------------------------------------------- per-request verification
const installCache = new Map(); // id -> { row, at }
const nonces = new Map();       // `${id}:${nonce}` -> expiry
const usage = new Map();        // id -> count since last flush
const lastTouch = new Map();
async function loadInstall(id) {
  const hit = installCache.get(id); if (hit && Date.now() - hit.at < 10000) return hit.row;
  await distReady();
  const row = await identityDb.prepare("SELECT install_id, public_key, status, trust, version_code, account_id, device_hash, kill_reason FROM dist_installs WHERE install_id = ?").get(id) || null;
  installCache.set(id, { row, at: Date.now() }); if (installCache.size > 20000) installCache.clear();
  return row;
}
export const forgetInstall = (id) => installCache.delete(id);
export async function installStatus(id) { if (!/^[0-9a-f-]{36}$/.test(String(id || ""))) return null; return (await loadInstall(id))?.status || null; }

export const signedString = ({ id, ts, nonce, bearer }) => `LOv1\n${id}\n${ts}\n${nonce}\n${sha256Hex(bearer || "")}`;

// headers: a Headers-like object with .get(). `bearer` is the raw session token (or "" for unauthenticated calls).
// Returns { ok:true, installId, trust } | { ok:false, code, message }.
export async function verifyRequest(headers, bearer = "") {
  const id = headers.get("x-lo-install"); const ts = +headers.get("x-lo-ts"); const nonce = headers.get("x-lo-nonce"); const sig = headers.get("x-lo-sig");
  if (!id || !sig) return { ok: false, code: "INSTALL_REQUIRED", message: "Open the official LinkedOut app to continue." };
  if (!/^[0-9a-f-]{36}$/.test(id) || !nonce || nonce.length > 40 || !ts) return { ok: false, code: "INSTALL_BAD_SIG", message: "Request could not be verified." };
  if (Math.abs(Date.now() - ts * 1000) > SKEW_MS) return { ok: false, code: "CLOCK_SKEW", message: "Your phone's clock looks wrong. Set the date and time to automatic." };
  const row = await loadInstall(id);
  if (!row) return { ok: false, code: "INSTALL_UNKNOWN", message: "This app copy needs to be set up again." };
  if (row.status === "killed") return { ok: false, code: "INSTALL_KILLED", message: "This copy of the app has been disabled." };
  if (row.status !== "active") return { ok: false, code: "INSTALL_REVOKED", message: "This copy of the app has been disabled. Reinstall LinkedOut from linkedoutnetwork.com/install." };
  const k = `${id}:${nonce}`; const t = Date.now();
  if (nonces.has(k)) return { ok: false, code: "REPLAY", message: "Request could not be verified." };
  let good = false;
  try { good = crypto.verify("sha256", Buffer.from(signedString({ id, ts, nonce, bearer })), { key: crypto.createPublicKey({ key: Buffer.from(row.public_key, "base64"), format: "der", type: "spki" }), dsaEncoding: "der" }, Buffer.from(sig, "base64")); } catch { good = false; }
  if (!good) return { ok: false, code: "INSTALL_BAD_SIG", message: "Request could not be verified." };
  nonces.set(k, t + 6 * 60000); if (nonces.size > 60000) for (const [kk, e] of nonces) if (e < t) nonces.delete(kk);
  usage.set(id, (usage.get(id) || 0) + 1);
  return { ok: true, installId: id, trust: row.trust, versionCode: row.version_code };
}
// Remember which account uses this install (at most once per 10 minutes per install).
export async function bindAccount(installId, accountId) {
  if (!accountId || Date.now() - (lastTouch.get(installId) || 0) < 600000) return; lastTouch.set(installId, Date.now()); if (lastTouch.size > 20000) lastTouch.clear();
  await identityDb.prepare("UPDATE dist_installs SET account_id = ?, last_seen = ? WHERE install_id = ?").run(accountId, now(), installId).catch(() => {});
}
export async function flushUsage() {
  if (!usage.size) return; await distReady();
  const day = now().slice(0, 10); const batch = [...usage]; usage.clear();
  for (const [id, n] of batch) await identityDb.prepare("INSERT INTO dist_usage (day, install_id, n) VALUES (?,?,?) ON CONFLICT (day, install_id) DO UPDATE SET n = dist_usage.n + excluded.n").run(day, id, n).catch(() => {});
}

// ---------------------------------------------------------------- gate (what the app asks at start-up and every few hours)
export async function gateFor(installId, versionCode) {
  const s = await settings(); await distReady();
  const inst = installId ? await loadInstall(installId) : null;
  const kills = (await identityDb.prepare("SELECT feature, reason FROM dist_kills WHERE active = 1 AND min_code <= ? AND max_code >= ?").all(versionCode || 0, versionCode || 0)).map((k) => ({ feature: k.feature, reason: k.reason || "" }));
  const min = +s.min_version_code || 0;
  const gone = versionCode ? await identityDb.prepare("SELECT 1 x FROM dist_withdrawn WHERE version_code = ?").get(versionCode) : null;
  let status = "ok";
  if (inst && inst.status === "killed") status = "killed";
  else if (gone) status = "killed";                                            // a withdrawn/deleted build: locks and wipes, the next official build works
  else if (inst && inst.status !== "active") status = "revoked";
  else if (versionCode && min && versionCode < min) status = "update_required";
  const { jobsEnabled } = await import("@/lib/flags");
  return { status, wipe: status === "killed", killReason: status === "killed" ? (inst?.kill_reason || (gone ? "This version of the app has been withdrawn. Install the latest official version." : "")) : undefined, mode: s.mode, tamperAction: s.tamper_action === "block" ? "block" : "report", minVersionCode: min, kills, serverTime: Date.now(), jobsEnabled: await jobsEnabled() };
}

// ---------------------------------------------------------------- response actions
export async function revokeInstall(staff, installId, reason = "", { endSessions = true } = {}) {
  await distReady();
  const r = await identityDb.prepare("UPDATE dist_installs SET status = 'revoked', revoke_reason = ?, revoked_at = ?, revoked_by = ? WHERE install_id = ? AND status = 'active'").run(String(reason).slice(0, 300), now(), staff?.id || "system", installId);
  forgetInstall(installId);
  if (!r.changes) throw bad("That install is already revoked or does not exist.", 404);
  await logEvent("revoke", { installId, detail: { by: staff?.id || "system", reason } });
  if (endSessions) { const row = await identityDb.prepare("SELECT account_id FROM dist_installs WHERE install_id = ?").get(installId); if (row?.account_id) { const { invalidateSession } = await import("@/lib/session-cache"); invalidateSession(row.account_id); } }
  const { bumpRevocations } = await import("./revocations.js"); bumpRevocations();
  return { ok: true };
}
export async function restoreInstall(staff, installId) {
  await distReady();
  const r = await identityDb.prepare("UPDATE dist_installs SET status = 'active', revoke_reason = NULL, revoked_at = NULL WHERE install_id = ? AND status = 'revoked'").run(installId);
  forgetInstall(installId); if (!r.changes) throw bad("That install is not revoked.", 404);
  await logEvent("restore", { installId, detail: { by: staff?.id } }); const { bumpRevocations } = await import("./revocations.js"); bumpRevocations();
}
export async function revokeByVersion(staff, versionCode, reason) {
  // Withdrawing a build is a KILL: those copies lock, wipe, and cannot register again (the next official build can).
  return killByVersion(staff, versionCode, reason || `version ${versionCode} withdrawn`);
}
// Revoke the install AND block the account behind it using the existing enforcement system.
export async function revokeAndBlock(staff, installId, reason, days = 30) {
  const r = await killInstall(staff, installId, reason, { blockDevice: true, blockAccountDays: days });
  return { blocked: true, ...r };
}
export { canonicalJson, P };

// ---------------------------------------------------------------- bulk responses and permanent release removal
// Revoke every ACTIVE install matching a fixed (code-written, never user-supplied) SQL condition. Capped at 5000 per run.
export async function revokeWhere(staff, where, params, reason) {
  await distReady();
  const rows = await identityDb.prepare(`SELECT install_id FROM dist_installs WHERE status = 'active' AND (${where}) LIMIT 5000`).all(...params);
  let n = 0; for (const r of rows) { try { await revokeInstall(staff, r.install_id, reason); n++; } catch { /* already revoked */ } }
  return n;
}
// Completely removes a release: its installs are revoked, its code is recorded as withdrawn (listed in the signed manifest, and any app still
// running it is told to update), and the release row is deleted so /dl/apk and the updater can never serve it again. The version code stays
// reserved. (The file itself sits in YOUR storage: delete it there too. It can no longer be reached through LinkedOut.)
export async function deleteRelease(staff, id, reason) {
  await distReady();
  const r = await identityDb.prepare("SELECT * FROM dist_releases WHERE id = ?").get(id); if (!r) throw bad("No such release.", 404);
  const revoked = await revokeByVersion(staff, r.version_code, reason || `release ${r.version_name} deleted`);
  await identityDb.prepare("INSERT INTO dist_withdrawn (version_code, version_name, reason, removed_by, removed_at, installs_revoked, sha256, url) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (version_code) DO NOTHING")
    .run(r.version_code, r.version_name, String(reason || "").slice(0, 300), staff?.id || null, now(), revoked, r.sha256, r.url);
  await identityDb.prepare("DELETE FROM dist_releases WHERE id = ?").run(id);
  const { bumpManifest } = await import("./db.js"); await bumpManifest();
  return { revoked, versionName: r.version_name, versionCode: r.version_code };
}