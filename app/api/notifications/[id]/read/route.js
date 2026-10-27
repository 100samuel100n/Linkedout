import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { markNotificationRead } from "@/lib/identity/service";

export async function POST(request, { params }) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });
  const { id } = await params;
  await markNotificationRead(id, accountId);
  return NextResponse.json({ ok: true });
}
