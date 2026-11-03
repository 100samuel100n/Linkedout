import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { report } from "@/lib/security/posture";
export async function POST(request) {
  const id = await getCurrentAccountId();
  if (!id) return NextResponse.json({ error: "Log in first." }, { status: 401 });
  const deviceId = request.headers.get("x-lo-device"); const b = await request.json().catch(() => null);
  if (!deviceId || !b) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const ev = await report(id, deviceId, b);
  return NextResponse.json({ compliant: ev.compliant, reasons: ev.reasons });
}
