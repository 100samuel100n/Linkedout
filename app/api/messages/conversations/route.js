import { NextResponse } from "next/server";
import { requireMember, limited, dmFail } from "@/lib/messaging/http";
import * as dm from "@/lib/messaging/service";

export async function GET(request) {
  const m = await requireMember({ verified: false });
  if (m.error) return m.error;
  const box = new URL(request.url).searchParams.get("box") || "inbox";
  try { return NextResponse.json(await dm.listConversations({ me: m.me, box: ["inbox", "requests", "archived"].includes(box) ? box : "inbox" })); }
  catch (e) { return dmFail(e); }
}
