// Message bodies are encrypted at rest with AES-256-GCM. Each conversation
// has its own key, derived (HKDF-SHA256) from a server master secret and the
// conversation id, so ciphertext copied from one conversation can't be
// decrypted or spliced into another, and a database dump alone reveals
// nothing. GCM's auth tag makes any tampering detectable, and the
// conversation id + sender are bound in as associated data.
//
// This is encryption AT REST, not end-to-end: the server can decrypt (it has
// to, to deliver messages). Set MESSAGE_ENCRYPTION_KEY to a long random
// string (e.g. `openssl rand -base64 48`) and keep it out of the database.
import crypto from "node:crypto";

function master() {
  const k = process.env.MESSAGE_ENCRYPTION_KEY || process.env.IDENTITY_SIGNING_SECRET;
  if (!k && process.env.NODE_ENV === "production") throw new Error("MESSAGE_ENCRYPTION_KEY is not set.");
  return Buffer.from(k || "dev-only-message-key", "utf8");
}

const keyCache = new Map();
function convKey(conversationId) {
  if (!keyCache.has(conversationId)) {
    if (keyCache.size > 500) keyCache.clear();
    keyCache.set(conversationId, Buffer.from(crypto.hkdfSync("sha256", master(), Buffer.from("linkedout-dm-v1"), Buffer.from(conversationId), 32)));
  }
  return keyCache.get(conversationId);
}

// -> "v1.<iv>.<tag>.<ciphertext>" (base64url parts)
export function encryptMessage(conversationId, senderKey, plaintext) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", convKey(conversationId), iv);
  c.setAAD(Buffer.from(`${conversationId}:${senderKey}`));
  const ct = Buffer.concat([c.update(String(plaintext), "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptMessage(conversationId, senderKey, payload) {
  if (!payload) return "";
  try {
    const [v, iv, tag, ct] = payload.split(".");
    if (v !== "v1") return "";
    const d = crypto.createDecipheriv("aes-256-gcm", convKey(conversationId), Buffer.from(iv, "base64url"));
    d.setAAD(Buffer.from(`${conversationId}:${senderKey}`));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
  } catch {
    return ""; // tampered or wrong key — never throw into a request
  }
}
