import { NextResponse } from "next/server";
import { restrictionError } from "@/lib/admin/enforce";
import { requireMember, limited, dmFail } from "@/lib/messaging/http";
import * as dm from "@/lib/messaging/service";

// Start a conversation: sends ONE short text as a request. Tiered daily cap.
export async function POST(request) {
  const m = await requireMember();
  if (m.error) return m.error;
  { const blocked = m.accountId && await restrictionError(m.accountId, "messaging"); if (blocked) return blocked; }
  const b = await request.json().catch(() => ({}));
  try {
    const blocked = await limited(m.accountId, "dm_request", m.tier);
    if (blocked) return blocked;
    return NextResponse.json(await dm.sendRequest({ me: m.me, myAccountId: m.accountId, targetKey: b.handle, text: b.text, tier: m.tier }), { status: 201 });
  } catch (e) { return dmFail(e); }
}
