import { NextResponse } from "next/server";
import { requireMember, dmFail } from "@/lib/messaging/http";
import { messagingFor } from "@/lib/tiers";
import * as dm from "@/lib/messaging/service";

// Message analytics — OUT PRO only. Aggregates about the caller's own messaging.
export async function GET() {
  const m = await requireMember({ verified: false });
  if (m.error) return m.error;
  if (!messagingFor(m.tier).analytics) return NextResponse.json({ locked: true, requires: "pro" });
  try { return NextResponse.json({ locked: false, ...(await dm.messageAnalytics({ me: m.me })) }); } catch (e) { return dmFail(e); }
}
