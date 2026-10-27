import crypto from "node:crypto";
import { signToken, verifyToken } from "./crypto.js";

// 2-minute, single-use ticket the server hands the native app after Google
// sign-in (see app/api/auth/google/callback). Lives in lib/ because Next route
// files may only export HTTP handlers.
const used = new Set();
export const makeExchangeTicket = (accountId) => signToken({ t: "native_xchg", a: accountId, j: crypto.randomUUID(), exp: Date.now() + 2 * 60 * 1000 });
export function takeExchangeTicket(code) {
  const p = code && verifyToken(code);
  if (!p || p.t !== "native_xchg" || used.has(p.j)) return null;
  used.add(p.j); if (used.size > 5000) used.clear();
  return p.a;
}
