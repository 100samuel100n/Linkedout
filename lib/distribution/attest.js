// Android Key Attestation verifier.
//
// Why this and not "check the signature in the app": anything the app reports about itself can be faked by a modified copy.
// Key Attestation is different. When the app creates its per-install key in the Android Keystore, the phone's secure hardware
// (TEE / StrongBox) signs a certificate chain that states, in an extension the app cannot edit:
//   * the exact package name and the SHA-256 of the certificate the APK was signed with,
//   * the challenge WE sent (so it cannot be replayed),
//   * whether the key lives in hardware, and the device's verified-boot state.
// The chain ends in a Google-published root. A repackaged/fake APK is signed with a different certificate, so it cannot
// obtain a chain that names ours. This works without Google Play services (Huawei, de-Googled phones, sideloads).
//
// Limits (be honest about them): a device with a compromised TEE or a leaked attestation key can still produce valid chains;
// emulators and old phones fall back to "software" attestation; roots must be configured (DIST_ATTEST_ROOTS) or the result
// is capped at "software" trust. Treat this as a very strong filter, not a proof of honesty.
import crypto from "node:crypto";
import { normHex } from "./canon.js";

const OID_ATTESTATION = "1.3.6.1.4.1.11129.2.1.17";

// ---- minimal DER reader -------------------------------------------------------------------------------------------------
export function readTLV(buf, off = 0) {
  if (off >= buf.length) throw new Error("DER: out of data");
  let p = off; const b0 = buf[p++];
  const cls = b0 >> 6, constructed = !!(b0 & 0x20); let tag = b0 & 0x1f;
  if (tag === 0x1f) { tag = 0; let b; do { b = buf[p++]; tag = (tag << 7) | (b & 0x7f); } while (b & 0x80); }
  let len = buf[p++];
  if (len & 0x80) { const n = len & 0x7f; if (n === 0 || n > 4) throw new Error("DER: bad length"); len = 0; for (let i = 0; i < n; i++) len = (len * 256) + buf[p++]; }
  const start = p, end = p + len; if (end > buf.length) throw new Error("DER: truncated");
  return { cls, constructed, tag, start, end, header: p - off, value: buf.subarray(start, end), next: end };
}
export function children(buf) { const out = []; let o = 0; while (o < buf.length) { const t = readTLV(buf, o); out.push(t); o = t.next; } return out; }
const intOf = (v) => { let n = 0n; for (const b of v) n = (n << 8n) | BigInt(b); return Number(n); };
function oidOf(v) {
  const parts = []; let n = 0n;
  for (let i = 0; i < v.length; i++) { n = (n << 7n) | BigInt(v[i] & 0x7f); if (!(v[i] & 0x80)) { if (!parts.length) { const f = Number(n / 40n > 2n ? 2n : n / 40n); parts.push(f, Number(n) - f * 40); } else parts.push(Number(n)); n = 0n; } }
  return parts.join(".");
}

// Pull the attestation extension (raw OCTET STRING contents) out of a DER certificate.
export function findExtension(certDer, oid) {
  const cert = readTLV(certDer, 0); const top = children(cert.value);       // tbs, sigAlg, sig
  const tbs = children(top[0].value);
  const ext = tbs.find((t) => t.cls === 2 && t.tag === 3);                  // [3] EXPLICIT extensions
  if (!ext) return null;
  const list = children(readTLV(ext.value, 0).value);
  for (const e of list) {
    const f = children(e.value); if (oidOf(f[0].value) !== oid) continue;
    const octet = f[f.length - 1]; return octet.value;
  }
  return null;
}

// KeyDescription (Android key attestation schema v1..v400)
export function parseKeyDescription(ext) {
  const kd = children(readTLV(ext, 0).value);
  const out = { attestationVersion: intOf(kd[0].value), attestationSecurityLevel: intOf(kd[1].value), keymasterSecurityLevel: intOf(kd[3].value), challenge: Buffer.from(kd[4].value), packages: [], certDigests: [], rootOfTrust: null, osVersion: null, osPatchLevel: null };
  for (const list of [kd[6], kd[7]]) {            // softwareEnforced, teeEnforced
    if (!list) continue;
    for (const f of children(list.value)) {
      if (f.cls !== 2) continue;
      const inner = f.value.length ? readTLV(f.value, 0) : null; if (!inner) continue;
      if (f.tag === 709) {                         // attestationApplicationId
        const aai = children(readTLV(inner.value, 0).value);
        for (const pi of children(aai[0].value)) out.packages.push(Buffer.from(children(pi.value)[0].value).toString("utf8"));
        for (const d of children(aai[1].value)) out.certDigests.push(normHex(Buffer.from(d.value).toString("hex")));
      } else if (f.tag === 704) {                  // rootOfTrust
        const r = children(inner.value); out.rootOfTrust = { deviceLocked: r[1].value[0] !== 0, verifiedBootState: intOf(r[2].value) };
      } else if (f.tag === 705) out.osVersion = intOf(inner.value);
      else if (f.tag === 706) out.osPatchLevel = intOf(inner.value);
    }
  }
  return out;
}
const BOOT = { 0: "verified", 1: "self-signed", 2: "unverified", 3: "failed" };

function toCert(b64) { return new crypto.X509Certificate(Buffer.from(b64, "base64")); }
export function parseRoots(pemBlob) {
  const out = []; for (const m of String(pemBlob || "").replace(/\\n/g, "\n").matchAll(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)) { try { out.push(new crypto.X509Certificate(m[0])); } catch { /* skip */ } }
  return out;
}
export const spkiHex = (cert) => cert.publicKey.export({ type: "spki", format: "der" }).toString("hex");

// Result: { ok, level: "hardware"|"software", reasons[], pkg, certDigests[], publicKeyDer(b64), bootState, deviceLocked, securityLevel, serials[] }
// `ok:false` means the registration must be refused (wrong challenge/package/certificate, broken chain).
export function verifyAttestation({ chain, challenge, expectedPackage, allowedCertDigests = [], roots = [], now = Date.now() }) {
  const fail = (reason, extra = {}) => ({ ok: false, level: "none", reasons: [reason], ...extra });
  if (!Array.isArray(chain) || chain.length < 1 || chain.length > 8) return fail("no certificate chain");
  let certs; try { certs = chain.map(toCert); } catch { return fail("certificate chain is not valid DER"); }
  const publicKeyDer = certs[0].publicKey.export({ type: "spki", format: "der" }).toString("base64");

  // 1. chain links
  for (let i = 0; i < certs.length - 1; i++) {
    if (!certs[i].verify(certs[i + 1].publicKey)) return fail(`chain link ${i} is not signed by its issuer`);
  }
  const last = certs[certs.length - 1];
  if (!last.verify(last.publicKey)) return fail("chain does not end in a self-signed root");
  const rootTrusted = roots.some((r) => spkiHex(r) === spkiHex(last));

  // 2. attestation extension, challenge, package, signing certificate
  const extRaw = findExtension(certs[0].raw, OID_ATTESTATION);
  if (!extRaw) return fail("no attestation extension (software-only key)", { publicKeyDer, softwareOnly: true });
  let kd; try { kd = parseKeyDescription(extRaw); } catch (e) { return fail("attestation extension could not be read"); }
  const reasons = [];
  if (!kd.challenge.equals(Buffer.from(challenge))) return fail("challenge mismatch (replay or wrong server)", { publicKeyDer });
  if (!kd.packages.includes(expectedPackage)) return fail(`unknown package: ${kd.packages.join(",") || "none"}`, { publicKeyDer, pkg: kd.packages[0] || null });
  const allowed = new Set(allowedCertDigests.map(normHex));
  if (!allowed.size) reasons.push("no official signing certificate configured yet");
  else if (!kd.certDigests.some((d) => allowed.has(d))) return fail("app is signed with a certificate that is not ours", { publicKeyDer, pkg: kd.packages[0], certDigests: kd.certDigests });

  // 3. trust level. Hardware needs: pinned root, TEE/StrongBox security level, and (informational) verified boot.
  const sec = Math.max(kd.attestationSecurityLevel, kd.keymasterSecurityLevel);
  const validNow = certs.every((c) => Date.parse(c.validFrom) <= now + 86400000 && Date.parse(c.validTo) >= now - 86400000 * 3650);
  let level = "software";
  if (rootTrusted && sec >= 1 && validNow) level = "hardware"; else if (!rootTrusted) reasons.push("attestation root not pinned or not recognised");
  if (sec < 1) reasons.push("key is not hardware-backed");
  const boot = kd.rootOfTrust ? BOOT[kd.rootOfTrust.verifiedBootState] || "unknown" : "unknown";
  if (kd.rootOfTrust && (kd.rootOfTrust.verifiedBootState !== 0 || !kd.rootOfTrust.deviceLocked)) reasons.push(`device boot state: ${boot}${kd.rootOfTrust.deviceLocked ? "" : ", bootloader unlocked"}`);
  return { ok: true, level, reasons, pkg: kd.packages[0], certDigests: kd.certDigests, publicKeyDer, bootState: boot, deviceLocked: kd.rootOfTrust?.deviceLocked ?? null, securityLevel: sec, osVersion: kd.osVersion, osPatchLevel: kd.osPatchLevel, serials: certs.map((c) => c.serialNumber) };
}
