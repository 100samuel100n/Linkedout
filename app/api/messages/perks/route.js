import { NextResponse } from "next/server";
import { requireMember } from "@/lib/messaging/http";
import { messagingFor } from "@/lib/tiers";

// What the caller's plan allows in messaging, so the UI can offer exactly that.
export async function GET() {
  const m = await requireMember({ verified: false });
  if (m.error) return m.error;
  return NextResponse.json({ tier: m.tier, ...messagingFor(m.tier) });
}
