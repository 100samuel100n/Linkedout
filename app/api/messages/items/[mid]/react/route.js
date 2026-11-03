import { NextResponse } from "next/server";
import { requireMember, limited, dmFail } from "@/lib/messaging/http";
import * as dm from "@/lib/messaging/service";

export async function POST(request, { params }) {
  const m = await requireMember();
  if (m.error) return m.error;
  const blocked = await limited(m.accountId, "react");
  if (blocked) return blocked;
  const { mid } = await params;
  const b = await request.json().catch(() => ({}));
  try { return NextResponse.json(await dm.reactToMessage({ me: m.me, messageId: mid, reaction: b.reaction === "like" ? "❤️" : b.reaction })); } catch (e) { return dmFail(e); }
}
