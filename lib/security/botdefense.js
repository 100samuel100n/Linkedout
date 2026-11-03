// Bot defence for sign-in, sign-up and password reset.
//  * Behavioural signals (time on form, keystrokes, pointer/touch activity, paste-only input) are scored 0-100.
//  * A CAPTCHA (Cloudflare Turnstile) is demanded adaptively: after failures from the IP, for poor IP reputation,
//    or when behaviour looks scripted. Set TURNSTILE_SITE_KEY + TURNSTILE_SECRET to enable it; without them the risk
//    score still drives tarpitting/blocking, it just can't show a puzzle.
//  * Native apps can't render Turnstile, so a risky native request is delayed and counted instead (tarpit).
import { countEvents, requestInfo, recordEvent } from "./core";
import { ipReputation } from "./reputation";

export const captchaConfigured = () => !!(process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET);
export const captchaSiteKey = () => process.env.TURNSTILE_SITE_KEY || null;

export function behaviorRisk(bx, { native = false } = {}) {
  if (!bx || typeof bx !== "object") return { score: native ? 20 : 45, why: ["no behaviour data"] };
  let score = 0; const why = [];
  const ms = +bx.ms || 0, keys = +bx.keys || 0, moves = +bx.moves || 0, pasted = !!bx.pasted, touch = !!bx.touch;
  if (ms < 1200) { score += 45; why.push("submitted in under 1.2 s"); } else if (ms < 2500 && keys < 6) { score += 20; why.push("very fast submit"); }
  if (keys === 0 && !pasted && !bx.autofill) { score += 35; why.push("no typing"); }
  if (!native && !touch && moves === 0) { score += 25; why.push("no pointer movement"); }
  if (bx.uniform) { score += 25; why.push("machine-regular keystroke timing"); }
  return { score: Math.min(100, score), why };
}

export async function verifyCaptcha(token, ip) {
  if (!captchaConfigured()) return true;
  if (!token) return false;
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET, response: token, ...(ip ? { remoteip: ip } : {}) }), signal: AbortSignal.timeout(5000) });
    return !!(await r.json()).success;
  } catch { return true; /* if Cloudflare is unreachable, don't lock everyone out */ }
}

// Returns { allow, captcha, delayMs, risk }. `kind` is "login" | "signup" | "reset".
export async function authGate({ kind, bx, captchaToken, native = false }) {
  const { ip } = await requestInfo();
  const beh = behaviorRisk(bx, { native });
  const fails = ip ? await countEvents("auth_fail_ip", ip, 10 * 60000) : 0;
  const rep = ip ? await ipReputation(ip).catch(() => ({ score: 0 })) : { score: 0 };
  const risk = Math.min(100, beh.score + Math.min(30, fails * 8) + Math.round(rep.score * 0.4));
  const must = process.env.CAPTCHA_ALWAYS === "true" || risk >= 55 || fails >= 3;
  if (ip && risk >= 55) await recordEvent("bot_risk", ip);
  if (native) return { allow: true, captcha: false, delayMs: risk >= 55 ? Math.min(6000, 1500 + risk * 40) : 0, risk, why: beh.why };
  if (!must) return { allow: true, captcha: false, delayMs: 0, risk, why: beh.why };
  if (!captchaConfigured()) return { allow: true, captcha: false, delayMs: risk >= 75 ? 4000 : 0, risk, why: beh.why };
  const ok = await verifyCaptcha(captchaToken, ip);
  return ok ? { allow: true, captcha: false, delayMs: 0, risk, why: beh.why } : { allow: false, captcha: true, delayMs: 0, risk, why: beh.why };
}
