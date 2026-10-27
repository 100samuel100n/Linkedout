import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { getOrCreateAlias } from "@/lib/identity/service";
import { raiseHand } from "@/lib/content/service";

export async function POST(request, { params }) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const identity = await getOrCreateAlias(accountId);
  const result = await raiseHand(id, identity.anonymousId, body?.raised !== false);
  if (!result) return NextResponse.json({ error: "You're not in this room." }, { status: 400 });
  return NextResponse.json(result);
}
