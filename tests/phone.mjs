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


export { phone, PKG, DIGEST, b64u, sha, hdrs };
