// Ed25519 signing of the distribution manifest and update responses.
//
// Trust model (read this before changing anything):
//  * The PRIVATE key never reaches a browser or a phone. Set DIST_SIGNING_KEY on the server (or, better, sign offline with
//    scripts/dist-sign.mjs and upload the result; a compromised web server then cannot forge a manifest).
//  * The PUBLIC key is compiled into the Android app (EXPO_PUBLIC_DIST_PUBLIC_KEY), so the app can reject a manifest or an
//    update that was not signed by you, even if someone points it at a fake server.
//  * People checking a download in a browser must compare the key FINGERPRINT with copies published in places the
//    attacker does not control (see docs/DISTRIBUTION.md). A website cannot vouch for itself.
import crypto from "node:crypto";
import { canonicalJson, b64u } from "./canon.js";

let cached;
function parsePrivate(raw) {
  const s = String(raw || "").trim().replace(/\\n/g, "\n");
  if (!s) return null;
  if (s.includes("BEGIN")) return crypto.createPrivateKey(s);
  return crypto.createPrivateKey({ key: Buffer.from(s, "base64"), format: "der", type: "pkcs8" });
}
export function signingKey() {
  if (cached !== undefined) return cached;
  try { const k = parsePrivate(process.env.DIST_SIGNING_KEY); cached = k ? { priv: k, pub: crypto.createPublicKey(k) } : null; } catch { cached = null; }
  return cached;
}
export const rawPublicKey = (pub) => pub.export({ type: "spki", format: "der" }).subarray(-32);
export const fingerprintOf = (raw32) => crypto.createHash("sha256").update(raw32).digest("hex").toUpperCase().match(/.{1,4}/g).join(" ");
export const keyIdOf = (raw32) => crypto.createHash("sha256").update(raw32).digest("hex").slice(0, 16);
export function publicKeyInfo() {
  const k = signingKey(); if (!k) return null;
  const raw = rawPublicKey(k.pub);
  return { alg: "Ed25519", keyId: keyIdOf(raw), publicKey: b64u(raw), fingerprint: fingerprintOf(raw) };
}
export function signPayload(payload) {
  const k = signingKey();
  if (!k) { const e = new Error("Distribution signing key is not configured. Run `node scripts/dist-keygen.mjs` and set DIST_SIGNING_KEY."); e.status = 503; throw e; }
  const info = publicKeyInfo();
  const sig = crypto.sign(null, Buffer.from(canonicalJson(payload), "utf8"), k.priv);
  return { payload, signature: b64u(sig), keyId: info.keyId, alg: "Ed25519" };
}
// Verify with a raw 32-byte Ed25519 public key (base64url). Used by tests, the CLI verifier and the server's own self-check.
export function verifyEnvelope(env, publicKeyB64u) {
  try {
    const raw = Buffer.from(publicKeyB64u, "base64url"); if (raw.length !== 32) return false;
    const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]);
    const pub = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
    return crypto.verify(null, Buffer.from(canonicalJson(env.payload), "utf8"), pub, Buffer.from(env.signature, "base64url"));
  } catch { return false; }
}
export function generateKeypair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const raw = rawPublicKey(publicKey);
  return { privatePem: privateKey.export({ type: "pkcs8", format: "pem" }), publicKey: b64u(raw), fingerprint: fingerprintOf(raw), keyId: keyIdOf(raw) };
}
