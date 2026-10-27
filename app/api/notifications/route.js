import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { getNotifications, getUnreadNotificationCount, deleteNotifications } from "@/lib/identity/service";

export async function GET() {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });

  return NextResponse.json({
    notifications: await getNotifications(accountId),
    unreadCount: await getUnreadNotificationCount(accountId),
  });
}

// Clear notifications from the caller's own inbox: { ids: [...] } removes those, no body (or { all: true }) clears everything.
export async function DELETE(request) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const removed = await deleteNotifications(accountId, Array.isArray(body?.ids) ? body.ids : null);
  return NextResponse.json({ ok: true, removed });
}
