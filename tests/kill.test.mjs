import test from "node:test"; import assert from "node:assert/strict"; import crypto from "node:crypto";
import { phone, PKG, DIGEST, b64u, sha, hdrs } from "./phone.mjs";

test("KILL: lock, device block, no re-register, signed kill order, version withdrawal, undo", async () => {
  const sign = await import("../lib/distribution/sign.js");
  process.env.DIST_APK_CERTS = DIGEST; const kp = sign.generateKeypair(); process.env.DIST_SIGNING_KEY = kp.privatePem;
  const inst = await import("../lib/distribution/installs.js"), db = await import("../lib/distribution/db.js"), kill = await import("../lib/distribution/kill.js");
  const { logged } = await import("./stub-enforce.mjs"); const { undoAction } = await import("../lib/admin/history.js");
  const DEV = sha("android-id-1234");
  const reg = async (devHash, code = 9) => {
    const { challenge } = await inst.createChallenge("1.1.1.1"); const ph = phone(Buffer.from(challenge, "base64url"), PKG, DIGEST); process.env.DIST_ATTEST_ROOTS = ph.rootPem;
    const proof = crypto.sign("sha256", Buffer.from(challenge, "base64url"), { key: ph.key, dsaEncoding: "der" });
    return inst.registerInstall({ body: { challenge, chain: ph.chain, proof: b64u(proof), versionCode: code, versionName: "1.0." + code, channel: "website", devHash, device: { model: "Pixel", sdk: 34 } }, ip: "5.5.5.5", country: "KE", headers: hdrs({ "cf-ipcity": "Nairobi", "cf-iplatitude": "-1.2921", "cf-iplongitude": "36.8219" }) });
  };
  await db.putSetting({ id: "t" }, "mode", "monitor");           // kills must work even in monitor mode
  const r1 = await reg(DEV); assert.ok(r1.installId);
  const row = await (await import("./stub-db.mjs")).identityDb.prepare("SELECT ip_enc, geo, device_hash FROM dist_installs WHERE install_id = ?").get(r1.installId);
  assert.ok(row.ip_enc && !row.ip_enc.includes("5.5.5.5"), "IP is stored encrypted");
  assert.match(row.geo, /Nairobi/); assert.equal(row.device_hash, DEV);

  await kill.killInstall({ id: "admin1", role: "admin" }, r1.installId, "pirated copy");
  const h = (nonce) => { const ts = Math.floor(Date.now() / 1000); const s = `LOv1\n${r1.installId}\n${ts}\n${nonce}\n${sha("")}`; return null; };
  assert.equal((await inst.gateFor(r1.installId, 9)).status, "killed"); assert.equal((await inst.gateFor(r1.installId, 9)).wipe, true);
  assert.equal(await inst.installStatus(r1.installId), "killed");
  const gate = await import("../lib/distribution/gate.js");
  const v = await gate.checkNativeSession(hdrs({ "x-lo-install": r1.installId }), "tok", "acct1"); assert.equal(v.allow, false); assert.equal(v.code, "INSTALL_KILLED");
  const v2 = await gate.checkNativeSession(hdrs({ "x-lo-dev": DEV }), "tok", "acct1"); assert.equal(v2.allow, false);   // even a fresh install id on that phone is refused

  // the same phone cannot register again
  await assert.rejects(() => reg(DEV), (e) => e.code === "INSTALL_KILLED" && e.status === 403);
  // a different phone can
  const other = await reg(sha("other-phone")); assert.ok(other.installId);

  // signed kill order verifies with the public key, and cannot be forged
  const lease = await kill.leaseFor(r1.installId, { verified: false });
  assert.equal(lease.env.payload.status, "killed"); assert.equal(lease.env.payload.wipe, true); assert.ok(sign.verifyEnvelope(lease.env, kp.publicKey));
  assert.equal(sign.verifyEnvelope({ ...lease.env, payload: { ...lease.env.payload, status: "ok" } }, kp.publicKey), false);
  // a healthy install needs a verified request to get a lease, and the lease expires
  assert.equal((await kill.leaseFor(other.installId, { verified: false })).needSignature, true);
  const ok = await kill.leaseFor(other.installId, { verified: true }); assert.equal(ok.env.payload.status, "ok"); assert.ok(ok.env.payload.expiresAt > Date.now());

  // edge payload carries everything the proxy needs
  const { distPayload } = await import("../lib/distribution/revocations.js"); const pay = await distPayload();
  assert.ok(pay.killed.includes(r1.installId)); assert.ok(pay.blockedDevices.includes(DEV));

  // withdrawing a build kills its installs, blocks new registrations of that build, but NOT the devices
  const v10 = await reg(sha("phone-v10"), 10);
  const n = await kill.killByVersion({ id: "admin1" }, 10, "release withdrawn"); assert.equal(n, 1);
  await (await import("./stub-db.mjs")).identityDb.prepare("INSERT INTO dist_withdrawn (version_code, version_name, removed_at) VALUES (10, '1.0.10', ?)").run(new Date().toISOString()); kill.resetKillCaches();
  await assert.rejects(() => reg(sha("phone-v10"), 10), (e) => e.code === "VERSION_WITHDRAWN");
  const again = await reg(sha("phone-v10"), 11); assert.ok(again.installId, "next official build registers on the same phone");

  // undo restores the first kill exactly and lifts the device block
  const entry = logged.find((l) => l.action === "install:kill" && l.target === r1.installId); assert.equal(entry.undo.kind, "install");
  const idb = (await import("./stub-db.mjs")).identityDb;
  await idb.exec("CREATE TABLE IF NOT EXISTS staff_audit_log (id TEXT PRIMARY KEY, actor_id TEXT, actor_role TEXT, action TEXT, target TEXT, detail TEXT, created_at TEXT, undo_kind TEXT, undo_data TEXT, undone_at TEXT, undone_by TEXT)");
  await idb.prepare("INSERT INTO staff_audit_log (id, actor_id, actor_role, action, target, created_at, undo_kind, undo_data) VALUES ('a1','admin1','admin','install:kill',?,?,?,?)").run(r1.installId, new Date().toISOString(), entry.undo.kind, JSON.stringify(entry.undo.data));
  const res = await undoAction({ id: "admin2" }, "a1"); assert.match(res.summary, /Restored 1/);
  assert.equal(await inst.installStatus(r1.installId), "active"); assert.equal(await kill.isDeviceBlocked(DEV), false);
  await assert.rejects(() => undoAction({ id: "admin2" }, "a1"), /already undone/);
});
