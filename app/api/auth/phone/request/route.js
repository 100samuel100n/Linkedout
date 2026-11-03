import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { requestPhoneCode, PhoneOtpError } from "@/lib/identity/phone-otp";
import { clientIp } from "@/lib/client-ip";

export async function POST(request) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body?.phone) return NextResponse.json({ error: "Phone number is required." }, { status: 400 });

  try {
    const result = await requestPhoneCode({ accountId, phone: body.phone, ip: clientIp(request) });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof PhoneOtpError) {
      const headers = e.extra?.retryAfterSec ? { "Retry-After": String(e.extra.retryAfterSec) } : undefined;
      return NextResponse.json({ error: e.message, code: e.code, ...e.extra }, { status: e.status, headers });
    }
    console.error("[phone/request]", e);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
