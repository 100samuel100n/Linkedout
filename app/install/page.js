import { identityDb } from "@/lib/identity/db";
import { distReady, settings, officialDomains, officialCerts } from "@/lib/distribution/db";
import { latestFor } from "@/lib/distribution/manifest";
import { publicKeyInfo } from "@/lib/distribution/sign";
import { colonHex } from "@/lib/distribution/canon";
import InstallClient from "./InstallClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "How to install LinkedOut", description: "How to install LinkedOut on Android and iPhone, why we distribute it ourselves, and how to check that your copy is genuine.", alternates: { canonical: "/install" } };

const KIND_ORDER = ["apk", "obtainium", "fdroid", "zapstore", "samsung", "huawei", "aptoide", "apkpure", "mirror"];
const KIND_NAME = { apk: "Direct APK", obtainium: "Obtainium", fdroid: "F-Droid repository", zapstore: "Zapstore", samsung: "Samsung Galaxy Store", huawei: "Huawei AppGallery", aptoide: "Aptoide", apkpure: "APKPure", mirror: "Mirror" };

export default async function InstallPage({ searchParams }) {
  const sp = await searchParams; let data = null;
  try {
    await distReady(); const s = await settings(); const rel = await latestFor(null); const key = publicKeyInfo();
    const channels = (await identityDb.prepare("SELECT id, kind, label, url, fingerprint, cert_sha256 FROM dist_channels WHERE enabled = 1 AND official = 1 ORDER BY sort, label").all()).sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    data = { apkEnabled: s.apk_enabled === "1", pwa: s.pwa_enabled === "1", pkg: s.package_name, domains: await officialDomains(), certs: (await officialCerts()).map(colonHex), key: key ? { fingerprint: key.fingerprint, keyId: key.keyId } : null, channels,
      rel: rel ? { name: rel.version_name, code: rel.version_code, sha256: rel.sha256, size: rel.size_bytes ? (rel.size_bytes / 1048576).toFixed(1) + " MB" : null, notes: rel.notes, date: rel.published_at ? rel.published_at.slice(0, 10) : null } : null };
  } catch { data = { apkEnabled: true, pwa: true, pkg: "", domains: [], certs: [], key: null, channels: [], rel: null }; }
  const sources = (process.env.DIST_FINGERPRINT_SOURCES || "").split(",").map((x) => x.trim()).filter(Boolean);
  return <InstallClient data={data} sources={sources} soon={!!sp?.soon} site={(process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "")} kindName={KIND_NAME} />;
}