import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { recordItemView, VIEW_KINDS } from "@/lib/views";

// Batch beacon for impressions the server never sees as a "detail" request (feed cards scrolling past, ads, rooms).
// Body: { views: [{ kind, id }] }, max 50 per call. Always answers 204-style ok; metrics must never break the UI.
export async function POST(request) {
  const b = await request.json().catch(() => ({}));
  const list = Array.isArray(b.views) ? b.views.slice(0, 50) : [];
  const accountId = await getCurrentAccountId().catch(() => null);
  const bucket = `${request.headers.get("x-forwarded-for") || ""}|${(request.headers.get("user-agent") || "").slice(0, 80)}`;
  await Promise.all(list.filter((v) => VIEW_KINDS.includes(v?.kind) && typeof v.id === "string" && v.id.length < 80)
    .map((v) => recordItemView(v.kind, v.id, { viewerId: accountId, bucket }).catch(() => {})));
  return NextResponse.json({ ok: true });
}
