import { NextResponse } from "next/server";
import { verifyCredentials } from "@/lib/identity/service";
import { identityDb } from "@/lib/identity/db";
import { throttle } from "@/lib/identity/throttle-http";

// Suspended/banned accounts can't hold a session, so an appeal authenticates
// with email + password directly instead of a cookie/token.
export async function POST(request) {
  const b = await request.json().catch(() => ({}));
  const email = b.email?.trim().toLowerCase();
  if (!email || !b.password || !b.message?.trim()) return NextResponse.json({ error: "Email, password and a message are required." }, { status: 400 });
  const limited = await throttle(request, [["ip", null, "appeal", { max: 10, windowMs: 3600e3, label: "appeals" }], ["email", email, "appeal", { max: 3, windowMs: 86400e3, label: "appeals for this account" }]]);
  if (limited) return limited;
  const acct = await verifyCredentials(email, b.password);
  if (!acct) return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });
  const row = await identityDb.prepare("SELECT status FROM accounts WHERE id = ?").get(acct.id);
  if (row.status === "active") return NextResponse.json({ error: "This account has no active restriction to appeal." }, { status: 400 });
  const open = await identityDb.prepare("SELECT id FROM appeals WHERE account_id = ? AND status = 'pending'").get(acct.id);
  if (open) return NextResponse.json({ error: "You already have an appeal under review." }, { status: 409 });
  const enf = await identityDb.prepare("SELECT id FROM enforcements WHERE account_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1").get(acct.id);
  await identityDb.prepare("INSERT INTO appeals (id, account_id, enforcement_id, message, created_at) VALUES (?,?,?,?,?)")
    .run(crypto.randomUUID(), acct.id, enf?.id || null, b.message.trim().slice(0, 2000), new Date().toISOString());
  return NextResponse.json({ ok: true });
}
