// Storage for direct distribution: releases, channels, per-install keys, events, policy, look-alikes, reports.
// Lives in the identity database next to the security tables (lib/security/core.js) so alerts, accounts and installs can be
// joined by the SOC. Nothing here stores an IP address in clear text: IPs are salted-hashed for counting only.
import crypto from "node:crypto";
import { identityDb } from "@/lib/identity/db";

export const now = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
export const bad = (m, status = 400) => Object.assign(new Error(m), { status });
export const J = (v) => JSON.stringify(v ?? {});
export const P = (s, d = {}) => { try { const v = JSON.parse(s); return v === null || v === undefined || (typeof v !== "object" && typeof d === "object") ? d : v; } catch { return d; } };
const SALT = () => process.env.IDENTITY_SIGNING_SECRET || "dev-only-insecure-secret-change-me";
export const hashIp = (ip) => (ip ? crypto.createHmac("sha256", SALT()).update("dist-ip:" + ip).digest("hex").slice(0, 24) : null);

let ready = null;
export function distReady() {
  if (!ready) ready = (async () => {
    await identityDb.exec(`
      CREATE TABLE IF NOT EXISTS dist_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT, updated_at TEXT);
      CREATE TABLE IF NOT EXISTS dist_releases (
        id TEXT PRIMARY KEY, version_name TEXT NOT NULL, version_code INTEGER NOT NULL, sha256 TEXT NOT NULL, size_bytes BIGINT, cert_sha256 TEXT,
        url TEXT NOT NULL, mirror_urls TEXT NOT NULL DEFAULT '[]', notes TEXT, mandatory INTEGER NOT NULL DEFAULT 0, min_supported INTEGER NOT NULL DEFAULT 0,
        min_android INTEGER NOT NULL DEFAULT 0, rollout_pct INTEGER NOT NULL DEFAULT 100, status TEXT NOT NULL DEFAULT 'draft',
        ota_runtime TEXT, created_by TEXT, created_at TEXT NOT NULL, published_at TEXT);
      CREATE UNIQUE INDEX IF NOT EXISTS dist_releases_vc ON dist_releases (version_code);
      CREATE TABLE IF NOT EXISTS dist_channels (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT NOT NULL, url TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, official INTEGER NOT NULL DEFAULT 1,
        cert_sha256 TEXT, fingerprint TEXT, notes TEXT, sort INTEGER NOT NULL DEFAULT 100, updated_at TEXT);
      CREATE TABLE IF NOT EXISTS dist_installs (
        install_id TEXT PRIMARY KEY, public_key TEXT NOT NULL, platform TEXT NOT NULL DEFAULT 'android', version_name TEXT, version_code INTEGER, channel TEXT,
        installer TEXT, cert_sha256 TEXT, trust TEXT NOT NULL DEFAULT 'none', attest TEXT, device TEXT, status TEXT NOT NULL DEFAULT 'active', revoke_reason TEXT,
        account_id TEXT, country TEXT, ip_hash TEXT, flags TEXT, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, revoked_at TEXT, revoked_by TEXT);
      CREATE INDEX IF NOT EXISTS dist_installs_acct ON dist_installs (account_id);
      CREATE INDEX IF NOT EXISTS dist_installs_seen ON dist_installs (last_seen);
      CREATE TABLE IF NOT EXISTS dist_challenges (id TEXT PRIMARY KEY, ip_hash TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS dist_events (id TEXT PRIMARY KEY, kind TEXT NOT NULL, channel TEXT, version_code INTEGER, install_id TEXT, device_hash TEXT, ip_hash TEXT, country TEXT, detail TEXT, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS dist_events_k ON dist_events (kind, created_at);
      CREATE TABLE IF NOT EXISTS dist_usage (day TEXT NOT NULL, install_id TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, install_id));
      CREATE TABLE IF NOT EXISTS dist_kills (id TEXT PRIMARY KEY, feature TEXT NOT NULL, min_code INTEGER NOT NULL DEFAULT 0, max_code INTEGER NOT NULL DEFAULT 2147483647, reason TEXT, active INTEGER NOT NULL DEFAULT 1, created_by TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dist_lookalikes (id TEXT PRIMARY KEY, target TEXT NOT NULL UNIQUE, kind TEXT NOT NULL DEFAULT 'domain', source TEXT, status TEXT NOT NULL DEFAULT 'suspected',
        similarity INTEGER, http_status INTEGER, evidence TEXT, registrar TEXT, abuse_contact TEXT, host_ns TEXT, ai_note TEXT, notes TEXT, first_seen TEXT NOT NULL, last_checked TEXT, reported_at TEXT);
      CREATE TABLE IF NOT EXISTS dist_pwa (
        device_id TEXT PRIMARY KEY, platform TEXT, os TEXT, os_version TEXT, browser TEXT, browser_version TEXT, form TEXT, display_mode TEXT, screen TEXT, lang TEXT, tz TEXT,
        build TEXT, country TEXT, ip_hash TEXT, account_id TEXT, status TEXT NOT NULL DEFAULT 'active', note TEXT, pending_signout INTEGER NOT NULL DEFAULT 0,
        opens INTEGER NOT NULL DEFAULT 0, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, flagged_by TEXT);
      CREATE INDEX IF NOT EXISTS dist_pwa_seen ON dist_pwa (last_seen);
      CREATE TABLE IF NOT EXISTS dist_withdrawn (version_code INTEGER PRIMARY KEY, version_name TEXT, reason TEXT, removed_by TEXT, removed_at TEXT NOT NULL, installs_revoked INTEGER NOT NULL DEFAULT 0, sha256 TEXT, url TEXT);
      CREATE TABLE IF NOT EXISTS dist_reports (id TEXT PRIMARY KEY, kind TEXT NOT NULL, target TEXT, detail TEXT, reporter TEXT, ip_hash TEXT, status TEXT NOT NULL DEFAULT 'open', ai_note TEXT, created_at TEXT NOT NULL, handled_by TEXT, handled_at TEXT);
    `);
    // ---- kill switch + richer install records (lib/distribution/kill.js, details.js) ----
    await identityDb.exec(`
      ALTER TABLE dist_installs ADD COLUMN IF NOT EXISTS device_hash TEXT;
      ALTER TABLE dist_installs ADD COLUMN IF NOT EXISTS kill_reason TEXT;
      ALTER TABLE dist_installs ADD COLUMN IF NOT EXISTS killed_at TEXT;
      ALTER TABLE dist_installs ADD COLUMN IF NOT EXISTS killed_by TEXT;
      ALTER TABLE dist_installs ADD COLUMN IF NOT EXISTS ip_enc TEXT;
      ALTER TABLE dist_installs ADD COLUMN IF NOT EXISTS geo TEXT;
      ALTER TABLE dist_installs ADD COLUMN IF NOT EXISTS precise TEXT;
      ALTER TABLE dist_installs ADD COLUMN IF NOT EXISTS hw TEXT;
      ALTER TABLE dist_pwa ADD COLUMN IF NOT EXISTS ip_enc TEXT;
      ALTER TABLE dist_pwa ADD COLUMN IF NOT EXISTS geo TEXT;
      ALTER TABLE dist_pwa ADD COLUMN IF NOT EXISTS precise TEXT;
      ALTER TABLE dist_pwa ADD COLUMN IF NOT EXISTS ua TEXT;
      ALTER TABLE dist_pwa ADD COLUMN IF NOT EXISTS kill_reason TEXT;
      CREATE INDEX IF NOT EXISTS dist_installs_dev ON dist_installs (device_hash);
      CREATE TABLE IF NOT EXISTS dist_blocked_devices (device_hash TEXT PRIMARY KEY, install_id TEXT, account_id TEXT, reason TEXT, created_by TEXT, created_at TEXT NOT NULL);
    `);
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

// ---------------------------------------------------------------- settings
export const DEFAULTS = {
  mode: "monitor",                 // off | monitor | enforce
  min_version_code: "0",
  min_trust: "software",           // none | software | hardware  (applied when mode = enforce)
  allowed_certs: "",               // comma-separated SHA-256 of OFFICIAL signing certificates (also read from DIST_APK_CERTS)
  package_name: process.env.ANDROID_PACKAGE || "com.linkedoutnetwork.linkedout",
  official_domains: "",            // comma-separated; defaults to the host of NEXT_PUBLIC_APP_URL
  ai_enabled: "0",
  pwa_enabled: "1",
  apk_enabled: "1",                // 1 = APK downloads offered on /install; 0 = web app only, for every device
  spike_threshold: "10",           // attestation failures in 15 minutes
  usage_daily_limit: "6000",       // requests per install per day before it is flagged
  manifest_ttl_hours: "72",
  manifest_seq: "1",
  clone_alerts: "1",
  lease_ttl_minutes: "1440",       // how long a signed licence lease lets the app run without asking the server again (offline grace)
  require_lease: "0",              // 1 = the app refuses to open without a valid, unexpired lease (blocks offline bypass of a kill)
  collect_details: "1",            // 1 = store encrypted IP + approximate location for installs (shown to admins)
  tamper_action: "report",         // report | block : what the app does itself when it sees a debugger / Frida / Xposed
};
let cache = { at: 0, v: null };
export async function settings(force = false) {
  if (!force && cache.v && Date.now() - cache.at < 10000) return cache.v;
  await distReady();
  const rows = await identityDb.prepare("SELECT key, value FROM dist_settings").all();
  cache = { at: Date.now(), v: { ...DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) } }; return cache.v;
}
export async function putSetting(staff, key, value, { bump = true } = {}) {
  await distReady();
  await identityDb.prepare("INSERT INTO dist_settings (key, value, updated_by, updated_at) VALUES (?,?,?,?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at").run(key, String(value), staff?.id || null, now());
  if (bump) await bumpManifest();
  cache.at = 0;
}
export async function bumpManifest() {
  await distReady();
  await identityDb.prepare("INSERT INTO dist_settings (key, value, updated_at) VALUES ('manifest_seq','2',?) ON CONFLICT (key) DO UPDATE SET value = CAST(CAST(dist_settings.value AS INTEGER) + 1 AS TEXT), updated_at = excluded.updated_at").run(now());
  cache.at = 0;
}
export const list = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
export async function officialCerts() {
  const s = await settings();
  return [...new Set([...list(s.allowed_certs), ...list(process.env.DIST_APK_CERTS)])].map((x) => x.replace(/[^0-9a-fA-F]/g, "").toUpperCase()).filter((x) => x.length === 64);
}
export async function officialDomains() {
  const s = await settings();
  let host = ""; try { host = new URL(process.env.NEXT_PUBLIC_APP_URL || "http://linkedoutnetwork.com").hostname; } catch { /* */ }
  return [...new Set([...list(s.official_domains), host].filter(Boolean).map((d) => d.toLowerCase()))];
}

// ---------------------------------------------------------------- events
export async function logEvent(kind, { channel = null, versionCode = null, installId = null, device = null, ip = null, country = null, detail = null } = {}) {
  await distReady();
  await identityDb.prepare("INSERT INTO dist_events (id, kind, channel, version_code, install_id, device_hash, ip_hash, country, detail, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(uid(), kind, channel, versionCode, installId, device, hashIp(ip), country, detail ? J(detail) : null, now());
}
export const countSince = async (kind, minutes, extraSql = "", ...p) => {
  await distReady();
  return +(await identityDb.prepare(`SELECT COUNT(*) c FROM dist_events WHERE kind = ? AND created_at > ? ${extraSql}`).get(kind, new Date(Date.now() - minutes * 60000).toISOString(), ...p)).c;
};