import { NextResponse } from "next/server";
import { signSession, getAccountById, isAccountDeactivated, reactivateAccount } from "@/lib/identity/service";
import { challengeIfNeeded } from "@/lib/identity/mfa";
import { takeExchangeTicket } from "@/lib/identity/native-ticket";
import { getAccountGate } from "@/lib/admin/enforce";

// Swaps the one-time ticket from the native Google flow for a real session token.
export async function POST(request) {
  const b = await request.json().catch(() => ({}));
  const accountId = takeExchangeTicket(b.code);
  if (!accountId) return NextResponse.json({ error: "That sign-in expired. Please try again." }, { status: 401 });
  const gate = await getAccountGate(accountId);
  if (gate.blocked) return NextResponse.json({ error: gate.message, code: "ACCOUNT_RESTRICTED" }, { status: 403 });
  const challenge = await challengeIfNeeded(accountId);
  if (challenge) return NextResponse.json({ twoFactorRequired: true, challenge });
  if (await isAccountDeactivated(accountId)) await reactivateAccount(accountId); // signing in again reactivates, as with a password
  const a = await getAccountById(accountId);
  return NextResponse.json({ token: await signSession(accountId), email: a.email, realName: a.realName, pseudonym: a.pseudonym });
}
