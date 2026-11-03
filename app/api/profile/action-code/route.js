import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { getAccountById } from "@/lib/identity/service";
import { sendActionCode } from "@/lib/identity/action-code";
import { RateLimitError } from "@/lib/identity/rate-limit";

// Emails a 6-digit code to the address on the account. Used to confirm deactivating or deleting it.
export async function POST(request) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const purpose = body?.purpose;
  if (purpose !== "deactivate" && purpose !== "delete") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const account = await getAccountById(accountId);
  if (!account) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  try {
    return NextResponse.json({ ok: true, ...(await sendActionCode(account, purpose)) });
  } catch (e) {
    if (e instanceof RateLimitError) return NextResponse.json({ error: e.message }, { status: 429, headers: { "Retry-After": String(Math.ceil(e.retryAfterMs / 1000)) } });
    if (e.status) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[action-code] send failed", e?.message);
    return NextResponse.json({ error: "We couldn't send the code. Please try again in a moment." }, { status: 500 });
  }
}
