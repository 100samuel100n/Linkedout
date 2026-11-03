import { NextResponse } from "next/server";
import { verifyEmailToken } from "@/lib/identity/service";

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const token = body?.token;
  if (!token) return NextResponse.json({ error: "Missing token." }, { status: 400 });

  const result = await verifyEmailToken(token);
  if (!result.ok) {
    const messages = {
      invalid: "That verification link isn't valid.",
      used: "That verification link was already used.",
      expired: "That verification link expired — request a new one from your profile.",
    };
    return NextResponse.json({ error: messages[result.reason] || "Could not verify email." }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
