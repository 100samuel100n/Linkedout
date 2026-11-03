import test from "node:test"; import assert from "node:assert/strict";
import { execFileSync } from "node:child_process"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import crypto from "node:crypto";

// Build a synthetic "phone": hardware-style attestation chain whose extension names our package + cert and carries the server's challenge.
const len = (n) => n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]);
const tlv = (t, c) => Buffer.concat([Buffer.from([t]), len(c.length), c]);
const int = (n) => { let h = n.toString(16); if (h.length % 2) h = "0" + h; let b = Buffer.from(h, "hex"); if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]); return tlv(2, b); };
const enu = (n) => tlv(10, Buffer.from([n])), oct = (b) => tlv(4, Buffer.from(b)), seq = (...x) => tlv(0x30, Buffer.concat(x)), set = (...x) => tlv(0x31, Buffer.concat(x)), bool = (v) => tlv(1, Buffer.from([v ? 255 : 0]));
const b128 = (n) => { const o = [n & 127]; n >>= 7; while (n) { o.unshift((n & 127) | 128); n >>= 7; } return Buffer.from(o); };
const ctx = (n, c) => Buffer.concat([Buffer.from([0xbf]), b128(n), len(c.length), c]);
const kd = (ch, pkg, digest) => seq(int(300), enu(1), int(300), enu(1), oct(ch), oct(Buffer.alloc(0)), seq(ctx(709, oct(seq(set(seq(oct(pkg), int(1))), set(oct(Buffer.from(digest, "hex"))))))), seq(ctx(704, seq(oct(Buffer.alloc(32, 7)), bool(true), enu(0), oct(Buffer.alloc(32, 9))))));
function phone(challenge, pkg, digest) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ph-")); const sh = (...a) => execFileSync("openssl", a, { cwd: d, stdio: "pipe" });
  sh("ecparam", "-name", "secp384r1", "-genkey", "-noout", "-out", "root.key"); sh("req", "-x509", "-new", "-key", "root.key", "-subj", "/CN=R", "-days", "3650", "-sha384", "-out", "root.pem");
  sh("ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", "leaf.key"); sh("req", "-new", "-key", "leaf.key", "-subj", "/CN=K", "-out", "leaf.csr");
  fs.writeFileSync(path.join(d, "e"), `1.3.6.1.4.1.11129.2.1.17=DER:${kd(challenge, pkg, digest).toString("hex")}\n`);
  sh("x509", "-req", "-in", "leaf.csr", "-CA", "root.pem", "-CAkey", "root.key", "-CAcreateserial", "-days", "300", "-sha256", "-extfile", "e", "-out", "leaf.pem");
  sh("pkcs8", "-topk8", "-nocrypt", "-in", "leaf.key", "-out", "leaf.p8");
  const x = (f) => new crypto.X509Certificate(fs.readFileSync(path.join(d, f)));
  return { chain: [x("leaf.pem").raw.toString("base64"), x("root.pem").raw.toString("base64")], rootPem: fs.readFileSync(path.join(d, "root.pem"), "utf8"), key: crypto.createPrivateKey(fs.readFileSync(path.join(d, "leaf.p8"))) };
}
const PKG = "com.linkedoutnetwork.linkedout", DIGEST = "AB".repeat(32), b64u = (b) => Buffer.from(b).toString("base64url");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const hdrs = (o) => ({ get: (k) => o[k.toLowerCase()] ?? null });

test("register → signed request → revoke → re-register (full flow)", async () => {
  process.env.DIST_APK_CERTS = DIGEST; process.env.DIST_SIGNING_KEY = (await import("../lib/distribution/sign.js")).generateKeypair().privatePem;
  const inst = await import("../lib/distribution/installs.js"); const db = await import("../lib/distribution/db.js"); const { alerts } = await import("./stub-db.mjs");
  // pin our synthetic root
  const mk = async () => { const { challenge } = await inst.createChallenge("1.2.3.4"); const ph = phone(Buffer.from(challenge, "base64url"), PKG, DIGEST); process.env.DIST_ATTEST_ROOTS = ph.rootPem; return { challenge, ph }; };
  await db.putSetting({ id: "t" }, "mode", "enforce");
  let { challenge, ph } = await mk();
  // NB: roots are cached on first use; first phone's root is the one pinned for this test run
  const proof = crypto.sign("sha256", Buffer.from(challenge, "base64url"), { key: ph.key, dsaEncoding: "der" });
  const reg = await inst.registerInstall({ body: { challenge, chain: ph.chain, proof: b64u(proof), versionCode: 7, versionName: "1.0.7", channel: "website", device: { model: "Pixel", sdk: 34 } }, ip: "1.2.3.4", country: "KE" });
  assert.ok(reg.installId); assert.equal(reg.trust, "hardware"); assert.equal(reg.gate.status, "ok");

  const signFor = (id, bearer, tsOff = 0, nonce = crypto.randomUUID()) => { const ts = Math.floor(Date.now() / 1000) + tsOff; const s = `LOv1\n${id}\n${ts}\n${nonce}\n${sha(bearer)}`; return { "x-lo-install": id, "x-lo-ts": String(ts), "x-lo-nonce": nonce, "x-lo-sig": crypto.sign("sha256", Buffer.from(s), { key: ph.key, dsaEncoding: "der" }).toString("base64") }; };
  const ok = await inst.verifyRequest(hdrs(signFor(reg.installId, "tok1")), "tok1"); assert.equal(ok.ok, true);
  assert.equal((await inst.verifyRequest(hdrs(signFor(reg.installId, "tok1")), "stolen-token")).code, "INSTALL_BAD_SIG");     // token bound to the key
  const h = signFor(reg.installId, "tok1"); assert.equal((await inst.verifyRequest(hdrs(h), "tok1")).ok, true); assert.equal((await inst.verifyRequest(hdrs(h), "tok1")).code, "REPLAY");
  assert.equal((await inst.verifyRequest(hdrs(signFor(reg.installId, "tok1", -3600)), "tok1")).code, "CLOCK_SKEW");
  assert.equal((await inst.verifyRequest(hdrs({}), "tok1")).code, "INSTALL_REQUIRED");

  // replayed challenge is refused and logged as a failure
  await assert.rejects(() => inst.registerInstall({ body: { challenge, chain: ph.chain, proof: b64u(proof), versionCode: 7 }, ip: "9.9.9.9" }), /could not be verified/);
  assert.ok(alerts.some((a) => a.type === "attest_failure"));

  // a repackaged copy (different signing cert) cannot register
  const c2 = await inst.createChallenge("6.6.6.6"); const evil = phone(Buffer.from(c2.challenge, "base64url"), PKG, "CD".repeat(32));
  const pr2 = crypto.sign("sha256", Buffer.from(c2.challenge, "base64url"), { key: evil.key, dsaEncoding: "der" });
  await assert.rejects(() => inst.registerInstall({ body: { challenge: c2.challenge, chain: evil.chain, proof: b64u(pr2), versionCode: 7 }, ip: "6.6.6.6" }), /could not be verified/);

  // admin revokes → that copy is dead immediately; gate tells it so
  await inst.revokeInstall({ id: "admin1" }, reg.installId, "test abuse");
  assert.equal((await inst.verifyRequest(hdrs(signFor(reg.installId, "tok1")), "tok1")).code, "INSTALL_REVOKED");
  assert.equal((await inst.gateFor(reg.installId, 7)).status, "revoked");
  const { distPayload } = await import("../lib/distribution/revocations.js"); assert.ok((await distPayload()).revoked.includes(reg.installId));

  // minimum version + feature kill
  await db.putSetting({ id: "t" }, "min_version_code", "10");
  assert.equal((await inst.gateFor(null, 7)).status, "update_required"); assert.equal((await inst.gateFor(null, 11)).status, "ok");
});
