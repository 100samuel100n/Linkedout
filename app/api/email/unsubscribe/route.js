import { NextResponse } from "next/server";
import { verifyToken } from "@/lib/identity/crypto";
import { identityDb } from "@/lib/identity/db";
import { getAppUrl } from "@/lib/config";

// One-click unsubscribe from announcement / offer emails (the link in every broadcast
// footer, plus the List-Unsubscribe-Post header mail apps use for their own button).
// It only switches off the "Announcements & offers" email channel — account/security
// emails are unaffected.
async function unsubscribe(token) {
  const p = token && verifyToken(token);
  if (!p || p.t !== "unsub" || !p.a) return false;
  await identityDb.prepare(
    "INSERT INTO notification_preferences (account_id, category, in_app, email, push) VALUES (?, 'announcements', 1, 0, 1) ON CONFLICT (account_id, category) DO UPDATE SET email = 0"
  ).run(p.a);
  return true;
}
const page = (ok) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe — LinkedOut</title></head>
<body style="margin:0;background:#F4F6FB;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1A2233;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px">
<div style="max-width:420px;background:#fff;border:1px solid #E5E8EF;border-radius:16px;padding:32px;text-align:center">
<div style="font-size:20px;font-weight:800;margin-bottom:14px">Linked<span style="color:#4C61FF">Out</span></div>
<h1 style="font-size:20px;margin:0 0 10px">${ok ? "You're unsubscribed" : "This link isn't valid"}</h1>
<p style="color:#6B7280;line-height:1.6;margin:0 0 20px">${ok ? "You won't get announcement or offer emails from us any more. You'll still receive important account and security emails." : "It may have expired. You can manage your email preferences from Settings any time."}</p>
<a href="${getAppUrl()}/settings#notifications" style="display:inline-block;background:#4C61FF;color:#fff;text-decoration:none;font-weight:700;border-radius:10px;padding:11px 22px">Manage preferences</a></div></body></html>`;

export async function GET(request) {
  const ok = await unsubscribe(new URL(request.url).searchParams.get("t")).catch(() => false);
  return new NextResponse(page(ok), { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
export async function POST(request) { // List-Unsubscribe-Post one-click
  const ok = await unsubscribe(new URL(request.url).searchParams.get("t")).catch(() => false);
  return NextResponse.json({ ok }, { status: ok ? 200 : 400 });
}
