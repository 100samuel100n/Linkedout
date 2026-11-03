// Minimal signed-token helpers. Deliberately hand-rolled instead of a JWT
// library to keep the payload obviously inspectable: base64url(json) + "." +
// HMAC-SHA256(payload, secret). Anyone can decode the payload (it's not
// encrypted — session tokens carry an account id, content tokens carry only
// an anonymous id), but nobody can forge or alter it without the secret.
import crypto from "node:crypto";

const SECRET = process.env.IDENTITY_SIGNING_SECRET || "dev-only-insecure-secret-change-me";

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

function sign(payloadB64) {
  return crypto.createHmac("sha256", SECRET).update(payloadB64).digest("base64url");
}

export function signToken(payload) {
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = sign(payloadB64);
  return `${payloadB64}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [payloadB64, sig] = token.split(".");
  const expected = sign(payloadB64);
  const sigBuf = Buffer.from(sig || "");
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
