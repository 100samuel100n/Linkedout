import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { registerPushToken, unregisterPushToken } from "@/lib/identity/service";

export async function POST(request) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const token = body?.token?.trim();
  if (!token) return NextResponse.json({ error: "token is required." }, { status: 400 });

  await registerPushToken(accountId, token, body?.platform || null);
  return NextResponse.json({ ok: true });
}

// Called on logout, so a shared/reset device stops receiving another
// account's pushes after signing out.
export async function DELETE(request) {
  const body = await request.json().catch(() => null);
  const token = body?.token?.trim();
  if (!token) return NextResponse.json({ error: "token is required." }, { status: 400 });
  await unregisterPushToken(token);
  return NextResponse.json({ ok: true });
}
