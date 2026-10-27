import { NextResponse } from "next/server";
import { getCurrentAccountId, clearSessionCookie } from "@/lib/session";
import { getAccountById, deleteAccount, verifyCredentials } from "@/lib/identity/service";
import { deleteAvatarFile } from "@/lib/avatars";
import { requireMfa } from "@/lib/identity/mfa";
import { checkActionCode } from "@/lib/identity/action-code";

// Requires re-entering the current password as confirmation (for
// password-based accounts) — a deliberate speed bump against an
// accidental or coerced one-click deletion. OAuth-only accounts (no
// password set) skip that check since there's nothing to re-enter.
export async function POST(request) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });

  const account = await getAccountById(accountId);
  if (!account) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (account.hasPassword) {
    const password = body?.password || "";
    const verified = await verifyCredentials(account.email, password);
    if (!verified) {
      return NextResponse.json({ error: "Incorrect password." }, { status: 400 });
    }
  }

  // Everyone confirms with a code emailed to the address on the account, 2FA or not.
  const emailCheck = await checkActionCode(accountId, "delete", body?.emailCode);
  if (emailCheck) return NextResponse.json({ error: emailCheck.error, code: emailCheck.code }, { status: emailCheck.status });

  const mfa = await requireMfa(accountId, body?.mfaCode);
  if (mfa) return NextResponse.json({ error: mfa.error, code: mfa.code }, { status: mfa.status });

  if (account.avatarPath) await deleteAvatarFile(account.avatarPath);
  await deleteAccount(accountId);
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
