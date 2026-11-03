// Register a new APK build as a DRAFT release (publish it afterwards in Admin -> Releases & Updates).
//   DIST_RELEASE_TOKEN=... node scripts/dist-release.mjs --apk app-release.apk --url https://downloads.example.com/LinkedOut-1.2.0.apk \
//        --name 1.2.0 --code 12 --site https://linkedoutnetwork.com [--notes "Fixes"] [--mirror https://...]
// It computes the SHA-256 and size itself and, if `apksigner` (Android SDK build-tools) is on PATH, reads the signing certificate
// so the server can refuse a build signed with the wrong key. Uploading the file to your storage/CDN is a separate step on purpose.
import crypto from "node:crypto"; import fs from "node:fs"; import { execFileSync } from "node:child_process";
const a = process.argv.slice(2), opt = (n, d = null) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; }, all = (n) => a.flatMap((x, i) => (x === n ? [a[i + 1]] : []));
const apk = opt("--apk"), url = opt("--url"), name = opt("--name"), code = opt("--code"), site = (opt("--site") || "").replace(/\/$/, ""), token = process.env.DIST_RELEASE_TOKEN;
if (!apk || !url || !name || !code || !site || !token) { console.error("need --apk --url --name --code --site and DIST_RELEASE_TOKEN"); process.exit(2); }
const buf = fs.readFileSync(apk), sha256 = crypto.createHash("sha256").update(buf).digest("hex");
let certSha256 = null; try { const out = execFileSync("apksigner", ["verify", "--print-certs", apk], { encoding: "utf8" }); certSha256 = out.match(/certificate SHA-256 digest: ([0-9a-f]{64})/i)?.[1] || null; } catch { console.warn("apksigner not found: certificate not checked client-side."); }
const r = await fetch(site + "/api/distribution/release", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify({ versionName: name, versionCode: +code, sha256, sizeBytes: buf.length, certSha256, url, mirrorUrls: all("--mirror"), notes: opt("--notes", "") }) });
console.log(r.status, await r.text()); console.log("sha256:", sha256, certSha256 ? "\ncert:  " + certSha256 : "");
