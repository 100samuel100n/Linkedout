// The signed distribution manifest: the one document that says what the real LinkedOut is and where it lives.
// Published at /.well-known/linkedout-distribution.json (and /api/distribution/manifest). Signed with Ed25519.
import crypto from "node:crypto";
import { identityDb } from "@/lib/identity/db";
import { signPayload, publicKeyInfo } from "./sign.js";
import { distReady, settings, officialCerts, officialDomains, list, P, bad } from "./db.js";
import { colonHex } from "./canon.js";

const site = () => (process.env.NEXT_PUBLIC_APP_URL || "http://linkedoutnetwork.com").replace(/\/$/, "");
const relOut = (r) => r && ({ versionName: r.version_name, versionCode: r.version_code, sha256: r.sha256, sizeBytes: r.size_bytes == null ? null : +r.size_bytes, apkUrl: r.url, mirrorUrls: P(r.mirror_urls, []), certSha256: r.cert_sha256 || null, minAndroidSdk: r.min_android || 0, mandatory: !!r.mandatory, minSupportedVersionCode: r.min_supported || 0, notes: r.notes || "", publishedAt: r.published_at });

export async function liveReleases() {
  await distReady();
  return identityDb.prepare("SELECT * FROM dist_releases WHERE status = 'live' ORDER BY version_code DESC").all();
}
// Staged rollout: a stable bucket 0-99 from the install id (or 0 when unknown so anonymous checks see the full rollout only at 100%).
export const bucketOf = (installId) => (installId ? crypto.createHash("sha256").update("rollout:" + installId).digest().readUInt16BE(0) % 100 : 99);
export async function latestFor(installId) {
  const rel = await liveReleases();
  return rel.find((r) => r.rollout_pct >= 100 || bucketOf(installId) < r.rollout_pct) || null;
}

export async function buildManifest() {
  await distReady(); const s = await settings();
  const info = publicKeyInfo(); if (!info) throw bad("Distribution signing key is not configured.", 503);
  const live = await liveReleases();
  const channels = (await identityDb.prepare("SELECT * FROM dist_channels WHERE enabled = 1 ORDER BY sort, label").all())
    .map((c) => ({ id: c.id, kind: c.kind, label: c.label, url: c.url, official: !!c.official, certSha256: c.cert_sha256 || null, fingerprint: c.fingerprint || null }));
  const domains = await officialDomains();
  const issued = Date.now(), ttl = Math.max(1, +s.manifest_ttl_hours || 72) * 3600000;
  const certs = await officialCerts();
  return signPayload({
    schema: 1, product: "LinkedOut", packageName: s.package_name,
    sequence: +s.manifest_seq || 1, issuedAt: new Date(issued).toISOString(), expiresAt: new Date(issued + ttl).toISOString(),
    official: { website: site(), installPage: `${site()}/install`, domains, pwa: s.pwa_enabled === "1" ? site() : null },
    signing: { apkCertSha256: certs.map(colonHex), manifestKeyId: info.keyId, manifestPublicKey: info.publicKey, manifestKeyFingerprint: info.fingerprint },
    downloads: { apk: s.apk_enabled === "1", webApp: s.pwa_enabled === "1" },
    latest: s.apk_enabled === "1" ? relOut(live[0]) || null : null,
    releases: live.slice(0, 5).map(relOut),
    channels,
    howToVerify: `${site()}/install#verify`,
  });
}

// Answer to the in-app updater. Signed so a fake server cannot push an update, and so the app can rely on the hash.
export async function buildUpdateResponse({ versionCode, installId, channel }) {
  const s = await settings();
  const rel = await latestFor(installId);
  const current = +versionCode || 0;
  const min = +s.min_version_code || 0;
  const r = rel ? relOut(rel) : null;
  const available = !!(r && r.versionCode > current);
  return signPayload({
    schema: 1, checkedAt: new Date().toISOString(), packageName: s.package_name, channel: channel || null,
    updateAvailable: available,
    mandatory: !!(available && (r.mandatory || current < min || current < (r.minSupportedVersionCode || 0))),
    latest: available ? r : null,
    minVersionCode: min,
  });
}
export { list };