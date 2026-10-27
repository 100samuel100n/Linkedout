import { NextResponse } from "next/server";
import { requireMember, limited, dmFail } from "@/lib/messaging/http";
import * as dm from "@/lib/messaging/service";

export async function GET(request, { params }) {
  const m = await requireMember({ verified: false });
  if (m.error) return m.error;
  const { id } = await params;
  const sp = new URL(request.url).searchParams;
  try { return NextResponse.json(await dm.getConversation({ me: m.me, myAccountId: m.accountId, conversationId: id, after: sp.get("after"), before: sp.get("before"), limit: sp.get("limit") })); }
  catch (e) { return dmFail(e); }
}

export async function PATCH(request, { params }) {
  const m = await requireMember({ verified: false });
  if (m.error) return m.error;
  const blocked = await limited(m.accountId, "dm_manage");
  if (blocked) return blocked;
  const { id } = await params;
  const b = await request.json().catch(() => ({}));
  try { return NextResponse.json(await dm.updateConversation({ me: m.me, conversationId: id, muted: b.muted, archived: b.archived, ttlSeconds: b.ttlSeconds })); }
  catch (e) { return dmFail(e); }
}

// "Delete chat": removes it for you only.
export async function DELETE(request, { params }) {
  const m = await requireMember({ verified: false });
  if (m.error) return m.error;
  const { id } = await params;
  try { return NextResponse.json(await dm.clearConversation({ me: m.me, conversationId: id })); } catch (e) { return dmFail(e); }
}
