import { NextResponse } from "next/server";
import { signSession, isAccountDeactivated, reactivateAccount, getAccountById } from "@/lib/identity/service";
import { readChallenge, checkCode } from "@/lib/identity/mfa";
import { getAccountGate } from "@/lib/admin/enforce";
import { createSessionCookie } from "@/lib/session";
import { throttle } from "@/lib/identity/throttle-http";

// Step 2 of sign-in for accounts with two-factor on.
export async function POST(request) {
  const b = await request.json().catch(() => ({}));
  const accountId = readChallenge(b.challenge);
  if (!accountId) return NextResponse.json({ error: "That sign-in expired. Please start again.", code: "CHALLENGE_EXPIRED" }, { status: 401 });
  const limited = await throttle(request, [["email", accountId, "login_2fa", { max: 8, windowMs: 15 * 60 * 1000, label: "code attempts" }]]);
  if (limited) return limited;
  if (!(await checkCode(accountId, b.code))) return NextResponse.json({ error: "That code is wrong or expired." }, { status: 401 });
  const gate = await getAccountGate(accountId);
  if (gate.blocked) return NextResponse.json({ error: gate.message, code: gate.resetRequired ? "PASSWORD_RESET_REQUIRED" : "ACCOUNT_RESTRICTED" }, { status: 403 });
  const wasDeactivated = await isAccountDeactivated(accountId);
  if (wasDeactivated) await reactivateAccount(accountId);
  const account = await getAccountById(accountId);
  await createSessionCookie(accountId);
  return NextResponse.json({ email: account.email, realName: account.realName, pseudonym: account.pseudonym, token: await signSession(accountId), reactivated: wasDeactivated });
}
