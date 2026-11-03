import { NextResponse } from "next/server";
import { setPinned } from "@/lib/content/service";
import { getCurrentAccountId } from "@/lib/session";
import { getAnonymousIdsForAccount } from "@/lib/identity/service";

export async function POST(request, { params }) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const pinned = body?.pinned !== false;

  try {
    const ownerAnonymousIds = await getAnonymousIdsForAccount(accountId);
    const updated = await setPinned(id, ownerAnonymousIds, pinned);
    return NextResponse.json(updated);
  } catch (e) {
    if (e.code === "NOT_OWNER") return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
