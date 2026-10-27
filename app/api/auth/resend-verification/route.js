import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { getAccountById, createEmailVerificationToken } from "@/lib/identity/service";
import { sendVerificationEmail } from "@/lib/email";

export async function POST() {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });

  const account = await getAccountById(accountId);
  if (!account) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  if (account.emailVerified) return NextResponse.json({ error: "Your email is already verified." }, { status: 400 });

  const token = await createEmailVerificationToken(accountId);
  const result = await sendVerificationEmail(account.email, token);
  return NextResponse.json({ ok: true, emailSent: result.sent });
}
