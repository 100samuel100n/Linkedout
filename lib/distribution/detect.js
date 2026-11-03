// Detections for the distribution/integrity system. Everything here ends up as an alert in Security Operations
// (lib/security/core.js), so the existing incident, containment, SIEM and audit machinery applies without changes.
//
//   registrations failing attestation (wrong certificate / unknown package)  -> attest_failure
//   spikes of failures                                                       -> integrity_spike
//   unknown app versions                                                     -> unknown_version
//   abnormal usage per install                                               -> install_abuse
//   user reports                                                             -> fake_report
//   look-alike domains / APK sites / cloned front-ends                       -> lookalike_domain, clone_site
import { identityDb } from "@/lib/identity/db";
import { distReady, settings, countSince, logEvent, uid, now, J, hashIp } from "./db.js";

const alert = async (a) => { const core = await import("@/lib/security/core"); return core.raiseAlert(a); };
const kindOfReason = (r = "") => /not ours/.test(r) ? "wrong_certificate" : /unknown package/.test(r) ? "unknown_package" : /challenge/.test(r) ? "replayed_or_stale_challenge" : /trust level/.test(r) ? "low_trust_device" : "other";

export async function alertFailure({ reason, ip, versionCode, detail = {} }) {
  const s = await settings(); if (s.mode === "off") return;
  const type = kindOfReason(reason);
  await alert({ type: "attest_failure", subject: ip ? `ip:${ip}` : `reason:${type}`, subjectKind: "ip", ip, detail: { type, reason, versionCode, ...detail }, title: `App registration failed attestation: ${type.replace(/_/g, " ")}`, dedupeMin: 30 });
  const n = await countSince("attest_fail", 15);
  if (n >= (+s.spike_threshold || 10)) {
    const rows = await identityDb.prepare("SELECT detail FROM dist_events WHERE kind = 'attest_fail' AND created_at > ? ORDER BY created_at DESC LIMIT 200").all(new Date(Date.now() - 15 * 60000).toISOString());
    const reasons = {}; for (const r of rows) { try { const k = kindOfReason(JSON.parse(r.detail).reason); reasons[k] = (reasons[k] || 0) + 1; } catch { /* */ } }
    await alert({ type: "integrity_spike", subject: "attest_fail_spike", detail: { failuresIn15Min: n, byType: reasons }, title: `Spike: ${n} app verification failures in 15 minutes`, dedupeMin: 60 });
  }
}

export async function noteVersion(versionCode, installId) {
  if (!versionCode) return; await distReady();
  const known = await identityDb.prepare("SELECT 1 x FROM dist_releases WHERE version_code = ?").get(versionCode);
  const any = await identityDb.prepare("SELECT COUNT(*) c FROM dist_releases").get();
  if (known || !+any.c) return;                    // nothing registered yet = system not set up, don't alarm
  await logEvent("unknown_version", { versionCode, installId });
  await alert({ type: "unknown_version", subject: `version:${versionCode}`, detail: { versionCode, installId }, title: `Unknown app version ${versionCode} is talking to the server`, dedupeMin: 240 });
}

export async function noteUserReport({ id, kind, target, detail }) {
  await alert({ type: "fake_report", subject: `report:${String(target || kind).slice(0, 80)}`, detail: { reportId: id, kind, target, text: String(detail || "").slice(0, 300) }, title: `User reported a possible fake: ${String(target || kind).slice(0, 60)}`, dedupeMin: 120 });
  const n = +(await identityDb.prepare("SELECT COUNT(*) c FROM dist_reports WHERE target = ? AND created_at > ?").get(target || "", new Date(Date.now() - 86400000).toISOString())).c;
  if (target && n >= 3) await alert({ type: "fake_report", subject: `multi:${target}`, detail: { reports24h: n, target }, title: `${n} reports in 24 h about ${String(target).slice(0, 60)}`, dedupeMin: 720 });
}

export async function noteCloneBeacon({ host, ip, referrer, path }) {
  await distReady(); const s = await settings(); if (s.clone_alerts !== "1") return;
  host = String(host || "").toLowerCase().slice(0, 120); if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return;
  const exists = await identityDb.prepare("SELECT id FROM dist_lookalikes WHERE target = ?").get(host);
  if (!exists) {
    await identityDb.prepare("INSERT INTO dist_lookalikes (id, target, kind, source, status, evidence, first_seen, last_checked) VALUES (?,?,?,?,?,?,?,?)").run(uid(), host, "domain", "clone-beacon", "suspected", J({ note: "Our front-end code ran on this host", referrer: String(referrer || "").slice(0, 200), path: String(path || "").slice(0, 100), ipHash: hashIp(ip) }), now(), now());
    await alert({ type: "clone_site", subject: `clone:${host}`, detail: { host }, title: `Our website code is running on another domain: ${host}`, dedupeMin: 1440 });
  } else await identityDb.prepare("UPDATE dist_lookalikes SET last_checked = ? WHERE id = ?").run(now(), exists.id);
}

// Runs every minute from instrumentation.js. Cheap unless it is time for the 10-minute or daily jobs.
let lastHeavy = 0, lastDaily = 0;
export async function sweep() {
  const { flushUsage } = await import("./installs.js"); await flushUsage();
  if (Date.now() - lastHeavy < 10 * 60000) return; lastHeavy = Date.now();
  const s = await settings(); if (s.mode === "off") return;
  const limit = +s.usage_daily_limit || 6000, day = now().slice(0, 10);
  const heavy = await identityDb.prepare("SELECT u.install_id, u.n, i.account_id, i.version_code FROM dist_usage u JOIN dist_installs i ON i.install_id = u.install_id WHERE u.day = ? AND u.n > ? AND i.status = 'active' ORDER BY u.n DESC LIMIT 25").all(day, limit);
  for (const h of heavy) await alert({ type: "install_abuse", subject: `install:${h.install_id}`, subjectKind: "install", accountId: h.account_id || null, detail: { installId: h.install_id, requestsToday: +h.n, limit, versionCode: h.version_code }, title: `One install made ${h.n} requests today (limit ${limit})`, dedupeMin: 720 });
  if (process.env.DIST_LOOKALIKE_AUTOSCAN === "true" && Date.now() - lastDaily > 24 * 3600000) { lastDaily = Date.now(); import("./lookalike.js").then((m) => m.scanAll({ auto: true })).catch((e) => console.error("[lookalike scan]", e?.message)); }
}
