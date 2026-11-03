// Verify a LinkedOut distribution manifest (and optionally an APK) from the command line. Node 18+.
//   node scripts/dist-verify.mjs https://linkedoutnetwork.com --key "<fingerprint you trust>" [--apk LinkedOut.apk]
// PASS needs ALL of: valid Ed25519 signature, key fingerprint equal to the one you supply, manifest not expired, APK hash listed.
import crypto from "node:crypto"; import fs from "node:fs";
const args = process.argv.slice(2); const site = (args[0] || "").replace(/\/$/, ""); const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
if (!site) { console.error("usage: node scripts/dist-verify.mjs https://your-domain --key \"<fingerprint>\" [--apk file.apk]"); process.exit(2); }
const canon = (v) => (v === null || typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v) ? "[" + v.map(canon).join(",") + "]" : "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}");
const env = await (await fetch(site + "/.well-known/linkedout-distribution.json")).json();
const raw = Buffer.from(env.payload.signing.manifestPublicKey, "base64url");
const fp = crypto.createHash("sha256").update(raw).digest("hex").toUpperCase().match(/.{1,4}/g).join(" ");
const pub = crypto.createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]), format: "der", type: "spki" });
const checks = [];
checks.push(["signature valid", crypto.verify(null, Buffer.from(canon(env.payload)), pub, Buffer.from(env.signature, "base64url"))]);
const want = opt("--key"); checks.push(["key fingerprint matches the one you trust", !!want && want.replace(/\s/g, "").toUpperCase() === fp.replace(/\s/g, "")]);
checks.push(["manifest not expired", Date.parse(env.payload.expiresAt) > Date.now()]);
const apk = opt("--apk"); if (apk) { const sum = crypto.createHash("sha256").update(fs.readFileSync(apk)).digest("hex"); checks.push(["APK hash is listed in the manifest", [env.payload.latest, ...(env.payload.releases || [])].filter(Boolean).some((r) => r.sha256 === sum)]); }
console.log("Manifest key fingerprint:", fp); console.log("Official domains:", (env.payload.official.domains || []).join(", ")); console.log("Latest:", env.payload.latest ? `${env.payload.latest.versionName} (${env.payload.latest.versionCode})` : "none");
for (const [n, ok] of checks) console.log(ok ? "PASS" : "FAIL", n);
process.exit(checks.every((c) => c[1]) ? 0 : 1);
