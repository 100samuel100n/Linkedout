import { NextResponse } from "next/server";
import { requireMember, limited, dmFail } from "@/lib/messaging/http";
import { messagingFor } from "@/lib/tiers";
import { draftOutreach, AiUnavailableError } from "@/lib/ai";
import { getPublicAliasProfile } from "@/lib/content/service";

// AI-assisted outreach — OUT PRO only. Drafts 3 short, respectful opening
// messages. Uses only what the other person has made public (their pseudonym
// and bio), never anything private, and the caller always edits before sending.
export async function POST(request) {
  const m = await requireMember();
  if (m.error) return m.error;
  if (!messagingFor(m.tier).aiOutreach) return NextResponse.json({ error: "AI-assisted outreach is part of OUT PRO.", code: "UPGRADE", upgrade: "pro" }, { status: 403 });
  const b = await request.json().catch(() => ({}));
  const goal = String(b.goal || "").trim().slice(0, 280);
  try {
    const blocked = await limited(m.accountId, "ai_outreach", m.tier);
    if (blocked) return blocked;
    const profile = b.handle ? await getPublicAliasProfile(String(b.handle)) : null;
    const drafts = await draftOutreach({ name: profile?.displayLabel || "them", bio: profile?.bio || "", goal, maxLen: messagingFor(m.tier).requestMaxLen });
    return NextResponse.json({ drafts });
  } catch (e) {
    if (e instanceof AiUnavailableError) return NextResponse.json({ error: e.message }, { status: 503 });
    return dmFail(e);
  }
}
