import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { changePassword } from "@/lib/identity/service";
import { requireMfa } from "@/lib/identity/mfa";

export async function POST(request) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const currentPassword = body?.currentPassword || "";
  const newPassword = body?.newPassword;
  if (!newPassword || newPassword.length < 8) {
    return NextResponse.json({ error: "New password needs to be at least 8 characters." }, { status: 400 });
  }

  const mfa = await requireMfa(accountId, body?.mfaCode);
  if (mfa) return NextResponse.json({ error: mfa.error, code: mfa.code }, { status: mfa.status });

  try {
    await changePassword(accountId, currentPassword, newPassword);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e.code === "WRONG_PASSWORD") {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("Change password failed:", e);
    return NextResponse.json({ error: "Could not change password." }, { status: 500 });
  }
}
