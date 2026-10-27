import { NextResponse } from "next/server";
import { requireMember, limited, dmFail } from "@/lib/messaging/http";
import * as dm from "@/lib/messaging/service";

export async function PATCH(request, { params }) {
  const m = await requireMember();
  if (m.error) return m.error;
  const { mid } = await params;
  const b = await request.json().catch(() => ({}));
  try { return NextResponse.json(await dm.editMessage({ me: m.me, messageId: mid, text: b.text })); } catch (e) { return dmFail(e); }
}
export async function DELETE(request, { params }) {
  const m = await requireMember({ verified: false });
  if (m.error) return m.error;
  const { mid } = await params;
  try { return NextResponse.json(await dm.deleteMessage({ me: m.me, messageId: mid })); } catch (e) { return dmFail(e); }
}
