import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { deleteNotification } from "@/lib/identity/service";

// Delete ONE notification from the caller's own inbox.
export async function DELETE(request, { params }) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });
  const { id } = await params;
  await deleteNotification(id, accountId);
  return NextResponse.json({ ok: true });
}
