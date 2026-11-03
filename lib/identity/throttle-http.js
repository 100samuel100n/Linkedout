import { NextResponse } from "next/server";
import { checkKeyedRateLimit, RateLimitError } from "./rate-limit.js";
import { clientIp } from "../client-ip.js";
import crypto from "node:crypto";

const h = (v) => crypto.createHash("sha256").update(String(v)).digest("hex").slice(0, 32);

// Runs a list of [keyKind, value, action, {max, windowMs, label}] checks.
// Returns a ready-to-return 429 NextResponse when one trips, else null.
export async function throttle(request, checks) {
  const ip = clientIp(request) || "unknown";
  try {
    for (const [kind, value, action, rule] of checks) {
      const key = kind === "ip" ? `ip:${h(ip)}` : `${kind}:${h(value)}`;
      await checkKeyedRateLimit(key, action, rule);
    }
    return null;
  } catch (e) {
    if (e instanceof RateLimitError) {
      return NextResponse.json({ error: e.message }, { status: 429, headers: { "Retry-After": String(Math.ceil(e.retryAfterMs / 1000)) } });
    }
    throw e;
  }
}
