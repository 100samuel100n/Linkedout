import { NextResponse } from "next/server";
import { verifyCredentials, signSession, isAccountDeactivated, reactivateAccount } from "@/lib/identity/service";
import { getAccountGate } from "@/lib/admin/enforce";
import { createSessionCookie } from "@/lib/session";
import { challengeIfNeeded } from "@/lib/identity/mfa";
import { noteAuthFailure, noteLogin, requestInfo } from "@/lib/security/core";
import { authGate, captchaSiteKey } from "@/lib/security/botdefense";
import { throttle } from "@/lib/identity/throttle-http";

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const email = body?.email?.trim().toLowerCase();
  const password = body?.password;

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  {
    const native = request.headers.get("x-lo-client") === "native";
    const g = await authGate({ kind: "login", bx: body?.bx, captchaToken: body?.captchaToken, native });
    if (g.delayMs) await new Promise((r) => setTimeout(r, g.delayMs));
    if (!g.allow) return NextResponse.json({ error: "Please complete the verification to continue.", code: "CAPTCHA_REQUIRED", siteKey: captchaSiteKey() }, { status: 428 });
  }

  // Brute-force protection: per IP and per target email.
  const limited = await throttle(request, [
    ["ip", null, "login", { max: 40, windowMs: 15 * 60 * 1000, label: "sign-in attempts" }],
    ["email", email, "login", { max: 8, windowMs: 15 * 60 * 1000, label: "sign-in attempts for this account" }],
  ]);
  if (limited) return limited;

  const account = await verifyCredentials(email, password);
  if (!account) {
    noteAuthFailure({ email, ip: (await requestInfo()).ip }).catch(() => {});
    return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });
  }

  // X-style reactivation: logging back in with the right password during
  // the deactivation period reactivates the account automatically, rather
  // than requiring a separate "reactivate" step. There's no cooldown grace
  // period enforced here (e.g. a 30-day hard deletion window) — deactivate
  // is reversible indefinitely until the account is explicitly deleted.
  const gate = await getAccountGate(account.id);
  if (gate.blocked) {
    return NextResponse.json({ error: gate.message, code: gate.resetRequired ? "PASSWORD_RESET_REQUIRED" : "ACCOUNT_RESTRICTED" }, { status: 403 });
  }
  const challenge = await challengeIfNeeded(account.id);
  if (challenge) return NextResponse.json({ twoFactorRequired: true, challenge });

  const wasDeactivated = await isAccountDeactivated(account.id);
  if (wasDeactivated) await reactivateAccount(account.id);

  noteLogin(account.id).catch(() => {});
  await createSessionCookie(account.id);
  const token = await signSession(account.id);
  return NextResponse.json({ email: account.email, realName: account.realName, token, reactivated: wasDeactivated });
}
