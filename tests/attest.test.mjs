import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import crypto from "node:crypto";
import { verifyAttestation, parseRoots } from "../lib/distribution/attest.js";

// ---- tiny DER encoder (test only) ----
const len = (n) => n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]);
const tlv = (tag, c) => Buffer.concat([Buffer.from([tag]), len(c.length), c]);
const int = (n) => { let h = n.toString(16); if (h.length % 2) h = "0" + h; let b = Buffer.from(h, "hex"); if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]); return tlv(2, b); };
const enu = (n) => tlv(10, Buffer.from([n])), oct = (b) => tlv(4, Buffer.from(b)), seq = (...x) => tlv(0x30, Buffer.concat(x)), set = (...x) => tlv(0x31, Buffer.concat(x)), bool = (v) => tlv(1, Buffer.from([v ? 255 : 0]));
const b128 = (n) => { const o = [n & 127]; n >>= 7; while (n) { o.unshift((n & 127) | 128); n >>= 7; } return Buffer.from(o); };
const ctx = (n, c) => Buffer.concat([Buffer.from([0xbf]), b128(n), len(c.length), c]);

function keyDescription({ challenge, pkg, digest, level = 1, boot = 0, locked = true }) {
  const aai = seq(set(seq(oct(pkg), int(1))), set(oct(Buffer.from(digest, "hex"))));
  const sw = seq(ctx(709, oct(aai)));
  const tee = seq(ctx(704, seq(oct(Buffer.alloc(32, 7)), bool(locked), enu(boot), oct(Buffer.alloc(32, 9)))));
  return seq(int(300), enu(level), int(300), enu(level), oct(challenge), oct(Buffer.alloc(0)), sw, tee);
}

function pki({ challenge, pkg, digest, level, boot, locked }) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "att-")); const sh = (...a) => execFileSync("openssl", a, { cwd: d, stdio: "pipe" });
  sh("ecparam", "-name", "secp384r1", "-genkey", "-noout", "-out", "root.key");
  sh("req", "-x509", "-new", "-key", "root.key", "-subj", "/CN=Test Root", "-days", "3650", "-sha384", "-out", "root.pem");
  sh("ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", "mid.key");
  sh("req", "-new", "-key", "mid.key", "-subj", "/CN=Test Mid", "-out", "mid.csr");
  fs.writeFileSync(path.join(d, "mid.ext"), "basicConstraints=critical,CA:TRUE\n");
  sh("x509", "-req", "-in", "mid.csr", "-CA", "root.pem", "-CAkey", "root.key", "-CAcreateserial", "-days", "3000", "-sha256", "-extfile", "mid.ext", "-out", "mid.pem");
  sh("ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", "leaf.key");
  sh("req", "-new", "-key", "leaf.key", "-subj", "/CN=Android Keystore Key", "-out", "leaf.csr");
  fs.writeFileSync(path.join(d, "leaf.ext"), `1.3.6.1.4.1.11129.2.1.17=DER:${keyDescription({ challenge, pkg, digest, level, boot, locked }).toString("hex")}\n`);
  sh("x509", "-req", "-in", "leaf.csr", "-CA", "mid.pem", "-CAkey", "mid.key", "-CAcreateserial", "-days", "300", "-sha256", "-extfile", "leaf.ext", "-out", "leaf.pem");
  const der = (f) => new crypto.X509Certificate(fs.readFileSync(path.join(d, f))).raw.toString("base64");
  return { chain: [der("leaf.pem"), der("mid.pem"), der("root.pem")], rootPem: fs.readFileSync(path.join(d, "root.pem"), "utf8") };
}

const DIGEST = "AB".repeat(32), PKG = "com.linkedoutnetwork.linkedout", CH = crypto.randomBytes(32);

test("genuine hardware attestation is accepted at hardware level", () => {
  const { chain, rootPem } = pki({ challenge: CH, pkg: PKG, digest: DIGEST });
  const r = verifyAttestation({ chain, challenge: CH, expectedPackage: PKG, allowedCertDigests: [DIGEST], roots: parseRoots(rootPem) });
  assert.equal(r.ok, true); assert.equal(r.level, "hardware"); assert.equal(r.pkg, PKG); assert.equal(r.bootState, "verified");
});
test("unpinned root caps trust at software", () => {
  const { chain } = pki({ challenge: CH, pkg: PKG, digest: DIGEST });
  const r = verifyAttestation({ chain, challenge: CH, expectedPackage: PKG, allowedCertDigests: [DIGEST], roots: [] });
  assert.equal(r.ok, true); assert.equal(r.level, "software");
});
test("repackaged app (different signing certificate) is refused", () => {
  const { chain, rootPem } = pki({ challenge: CH, pkg: PKG, digest: "CD".repeat(32) });
  const r = verifyAttestation({ chain, challenge: CH, expectedPackage: PKG, allowedCertDigests: [DIGEST], roots: parseRoots(rootPem) });
  assert.equal(r.ok, false); assert.match(r.reasons[0], /not ours/);
});
test("unknown package name is refused", () => {
  const { chain, rootPem } = pki({ challenge: CH, pkg: "com.evil.linkedout", digest: DIGEST });
  const r = verifyAttestation({ chain, challenge: CH, expectedPackage: PKG, allowedCertDigests: [DIGEST], roots: parseRoots(rootPem) });
  assert.equal(r.ok, false); assert.match(r.reasons[0], /unknown package/);
});
test("replayed / wrong challenge is refused", () => {
  const { chain, rootPem } = pki({ challenge: CH, pkg: PKG, digest: DIGEST });
  const r = verifyAttestation({ chain, challenge: crypto.randomBytes(32), expectedPackage: PKG, allowedCertDigests: [DIGEST], roots: parseRoots(rootPem) });
  assert.equal(r.ok, false); assert.match(r.reasons[0], /challenge/);
});
test("broken chain (leaf not signed by issuer) is refused", () => {
  const a = pki({ challenge: CH, pkg: PKG, digest: DIGEST }), b = pki({ challenge: CH, pkg: PKG, digest: DIGEST });
  const r = verifyAttestation({ chain: [a.chain[0], b.chain[1], b.chain[2]], challenge: CH, expectedPackage: PKG, allowedCertDigests: [DIGEST], roots: parseRoots(b.rootPem) });
  assert.equal(r.ok, false); assert.match(r.reasons[0], /not signed by its issuer/);
});
test("unlocked bootloader is reported but still verifiable", () => {
  const { chain, rootPem } = pki({ challenge: CH, pkg: PKG, digest: DIGEST, boot: 2, locked: false });
  const r = verifyAttestation({ chain, challenge: CH, expectedPackage: PKG, allowedCertDigests: [DIGEST], roots: parseRoots(rootPem) });
  assert.equal(r.ok, true); assert.ok(r.reasons.some((x) => /bootloader unlocked/.test(x)));
});
test("software-only key (no extension) is flagged", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "att-")); const sh = (...a) => execFileSync("openssl", a, { cwd: d, stdio: "pipe" });
  sh("req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", "k.pem", "-subj", "/CN=x", "-days", "5", "-out", "c.pem");
  const der = new crypto.X509Certificate(fs.readFileSync(path.join(d, "c.pem"))).raw.toString("base64");
  const r = verifyAttestation({ chain: [der], challenge: CH, expectedPackage: PKG, allowedCertDigests: [DIGEST], roots: [] });
  assert.equal(r.ok, false); assert.equal(r.softwareOnly, true);
});
