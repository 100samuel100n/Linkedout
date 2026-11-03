import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { confirmPhoneCode, PhoneOtpError } from "@/lib/identity/phone-otp";
import { clientIp } from "@/lib/client-ip";

export async function POST(request) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });

  const body = await request.json().catch(() => null);
  try {
    await confirmPhoneCode({ accountId, code: body?.code, ip: clientIp(request) });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof PhoneOtpError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    console.error("[phone/confirm]", e);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
