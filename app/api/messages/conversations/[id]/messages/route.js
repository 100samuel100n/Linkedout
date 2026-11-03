import { NextResponse } from "next/server";
import { restrictionError } from "@/lib/admin/enforce";
import { requireMember, limited, dmFail } from "@/lib/messaging/http";
import * as dm from "@/lib/messaging/service";

export async function POST(request, { params }) {
  const m = await requireMember();
  if (m.error) return m.error;
  { const blocked = m.accountId && await restrictionError(m.accountId, "messaging"); if (blocked) return blocked; }
  const blocked = await limited(m.accountId, "dm_send");
  if (blocked) return blocked;
  const daily = await limited(m.accountId, "dm_daily", m.tier);
  if (daily) return daily;
  const { id } = await params;
  const b = await request.json().catch(() => ({}));
  try { return NextResponse.json(await dm.sendMessage({ me: m.me, conversationId: id, text: b.text, replyTo: b.replyTo || null, clientId: b.clientId, tier: m.tier, attachment: b.attachment || null }), { status: 201 }); }
  catch (e) { return dmFail(e); }
}
