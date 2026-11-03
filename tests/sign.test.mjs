import test from "node:test"; import assert from "node:assert/strict";
import crypto from "node:crypto"; import { execFileSync } from "node:child_process";
import { canonicalJson } from "../lib/distribution/canon.js";
import { generateKeypair, verifyEnvelope } from "../lib/distribution/sign.js";

test("canonical JSON is key-order independent", () => { assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}'); });

test("envelope signs and verifies; any tampering fails", async () => {
  process.env.DIST_SIGNING_KEY = generateKeypair().privatePem;
  const { signPayload, publicKeyInfo } = await import("../lib/distribution/sign.js?x=" + Math.random());
  const env = signPayload({ latest: { versionCode: 5, sha256: "aa" }, official: { domains: ["linkedoutnetwork.com"] } });
  const pk = publicKeyInfo().publicKey;
  assert.equal(verifyEnvelope(env, pk), true);
  assert.equal(verifyEnvelope({ ...env, payload: { ...env.payload, latest: { versionCode: 6, sha256: "bb" } } }, pk), false);          // swapped hash
  assert.equal(verifyEnvelope(env, generateKeypair().publicKey), false);                                                          // other key
  const bad = Buffer.from(env.signature, "base64url"); bad[0] ^= 0xff;
  assert.equal(verifyEnvelope({ ...env, signature: bad.toString("base64url") }, pk), false);                                    // flipped signature byte
});

test("browser/CLI canonicalisation matches the server's (same bytes)", () => {
  const canon = (v) => (v === null || typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v) ? "[" + v.map(canon).join(",") + "]" : "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}");
  const o = { z: null, a: "é\u2028\"", n: [1, 2.5, { y: true, x: false }], u: undefined };
  assert.equal(canon(o), canonicalJson(o));
});

// ---- per-install request signatures: what the phone produces (ECDSA P-256, DER) must verify with the stored SPKI
test("install request signature verifies and is bound to the token", async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
  const signed = (id, ts, nonce, bearer) => `LOv1\n${id}\n${ts}\n${nonce}\n${sha(bearer || "")}`;
  const id = crypto.randomUUID(), ts = Math.floor(Date.now() / 1000), nonce = "n123";
  const sig = crypto.sign("sha256", Buffer.from(signed(id, ts, nonce, "tokenA")), { key: privateKey, dsaEncoding: "der" });
  const spki = publicKey.export({ type: "spki", format: "der" });
  const ver = (bearer) => crypto.verify("sha256", Buffer.from(signed(id, ts, nonce, bearer)), { key: crypto.createPublicKey({ key: spki, format: "der", type: "spki" }), dsaEncoding: "der" }, sig);
  assert.equal(ver("tokenA"), true); assert.equal(ver("stolen-other-token"), false);
});
