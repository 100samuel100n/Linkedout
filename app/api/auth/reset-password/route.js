import { NextResponse } from "next/server";
import { resetPasswordWithToken } from "@/lib/identity/service";

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const token = body?.token;
  const newPassword = body?.newPassword;
  if (!token || !newPassword) return NextResponse.json({ error: "Token and new password are required." }, { status: 400 });
  if (newPassword.length < 8) return NextResponse.json({ error: "Password needs to be at least 8 characters." }, { status: 400 });

  const result = await resetPasswordWithToken(token, newPassword);
  if (!result.ok) {
    const messages = {
      invalid: "That reset link isn't valid.",
      used: "That reset link was already used.",
      expired: "That reset link expired — request a new one.",
    };
    return NextResponse.json({ error: messages[result.reason] || "Could not reset password." }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
