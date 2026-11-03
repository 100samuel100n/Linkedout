import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { markAllNotificationsRead } from "@/lib/identity/service";

export async function POST() {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });
  await markAllNotificationsRead(accountId);
  return NextResponse.json({ ok: true });
}
