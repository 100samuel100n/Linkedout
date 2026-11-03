import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { registerPushToken, unregisterPushToken } from "@/lib/identity/service";
import { identityDb } from "@/lib/identity/db";
import { encodeToken, validateSubscription, vapidConfigured, vapidPublicKey, sendWebPush } from "@/lib/webpush";
import { throttle } from "@/lib/identity/throttle-http";

// Web-app push subscriptions. GET: is push available + the public key. POST { subscription } registers this device for the signed-in
// account; POST { test: true } sends a test notification to the caller's own web devices. DELETE { endpoint, keys } removes one (on logout / turn off).
export const dynamic = "force-dynamic";
export async function GET() {
  return NextResponse.json({ configured: vapidConfigured(), publicKey: vapidPublicKey() }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });
  const limited = await throttle(request, [["ip", null, "web_push", { max: 30, windowMs: 3600000, label: "notification setup attempts" }]]); if (limited) return limited;
  if (!vapidConfigured()) return NextResponse.json({ error: "Notifications are not available right now." }, { status: 503 });
  const body = await request.json().catch(() => null);
  try {
    if (body?.test) {
      const rows = await identityDb.prepare("SELECT token FROM push_tokens WHERE account_id = ? AND platform = 'web'").all(accountId);
      if (!rows.length) return NextResponse.json({ error: "This device is not subscribed yet." }, { status: 409 });
      const r = await sendWebPush(rows.map((x) => x.token), { title: "LinkedOut", body: "Notifications are on for this device.", data: { url: "/notifications", type: "test" }, category: "test" });
      for (const t of r.invalidTokens) await unregisterPushToken(t);
      return NextResponse.json({ ok: r.sent > 0, sent: r.sent });
    }
    const sub = validateSubscription(body?.subscription);
    // Cap per account so one account cannot fan out to hundreds of endpoints.
    const n = await identityDb.prepare("SELECT COUNT(*) c FROM push_tokens WHERE account_id = ? AND platform = 'web'").get(accountId);
    const token = encodeToken(sub); const existing = await identityDb.prepare("SELECT 1 x FROM push_tokens WHERE token = ?").get(token);
    if (!existing && +n.c >= 10) return NextResponse.json({ error: "Too many devices are subscribed. Turn notifications off on one you no longer use." }, { status: 409 });
    await registerPushToken(accountId, token, "web");
    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ error: e.status ? e.message : "Something went wrong." }, { status: e.status || 500 }); }
}
export async function DELETE(request) {
  const body = await request.json().catch(() => null);
  try { await unregisterPushToken(encodeToken(validateSubscription(body))); } catch { /* nothing to remove */ }
  return NextResponse.json({ ok: true });
}