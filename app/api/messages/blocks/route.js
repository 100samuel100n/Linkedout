import { NextResponse } from "next/server";
import { requireMember, limited, dmFail } from "@/lib/messaging/http";
import * as dm from "@/lib/messaging/service";

export async function GET() {
  const m = await requireMember({ verified: false });
  if (m.error) return m.error;
  return NextResponse.json(await dm.listBlocks(m.me));
}
export async function POST(request) {
  const m = await requireMember({ verified: false });
  if (m.error) return m.error;
  const blocked = await limited(m.accountId, "dm_manage");
  if (blocked) return blocked;
  const b = await request.json().catch(() => ({}));
  try { return NextResponse.json(await dm.blockUser({ me: m.me, targetKey: b.handle })); } catch (e) { return dmFail(e); }
}
export async function DELETE(request) {
  const m = await requireMember({ verified: false });
  if (m.error) return m.error;
  const handle = new URL(request.url).searchParams.get("handle");
  try { return NextResponse.json(await dm.unblockUser({ me: m.me, targetKey: handle })); } catch (e) { return dmFail(e); }
}
