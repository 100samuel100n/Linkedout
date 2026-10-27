import { NextResponse } from "next/server";
import { requireMember, limited, dmFail } from "@/lib/messaging/http";
import * as dm from "@/lib/messaging/service";

export async function POST(request, { params }) {
  const m = await requireMember({ verified: false });
  if (m.error) return m.error;
  const blocked = await limited(m.accountId, "dm_report");
  if (blocked) return blocked;
  const { id } = await params;
  const b = await request.json().catch(() => ({}));
  try { return NextResponse.json(await dm.reportConversation({ me: m.me, conversationId: id, reason: b.reason, details: b.details }), { status: 201 }); }
  catch (e) { return dmFail(e); }
}
