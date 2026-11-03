import { NextResponse } from "next/server";
import { requireMember, limited, dmFail } from "@/lib/messaging/http";
import * as dm from "@/lib/messaging/service";

export async function GET() {
  const m = await requireMember({ verified: false });
  if (m.error) return NextResponse.json({ unread: 0, requests: 0, total: 0 });
  return NextResponse.json(await dm.unreadSummary(m.me));
}
