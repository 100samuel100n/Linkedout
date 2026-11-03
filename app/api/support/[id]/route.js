import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { identityDb } from "@/lib/identity/db";
import { throttle } from "@/lib/identity/throttle-http";

async function mine(accountId, id) {
  return identityDb.prepare("SELECT * FROM support_tickets WHERE id = ? AND account_id = ?").get(id, accountId);
}

// One of your tickets, with the conversation. Internal staff notes are never included.
export async function GET(_req, { params }) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });
  const { id } = await params;
  const t = await mine(accountId, id);
  if (!t) return NextResponse.json({ error: "We couldn't find that request." }, { status: 404 });
  const msgs = await identityDb.prepare("SELECT kind, body, created_at FROM support_messages WHERE ticket_id = ? AND kind <> 'note' ORDER BY created_at ASC").all(id);
  return NextResponse.json({
    ticket: { id: t.id, ref: "T-" + t.id.slice(0, 6).toUpperCase(), subject: t.subject, category: t.category, status: t.status, createdAt: t.created_at },
    messages: [{ from: "you", body: t.body, at: t.created_at }, ...msgs.map((m) => ({ from: m.kind === "staff" ? "support" : "you", body: m.body, at: m.created_at }))],
  });
}

// Add a reply (reopens a resolved ticket).
export async function POST(request, { params }) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });
  const { id } = await params;
  const t = await mine(accountId, id);
  if (!t) return NextResponse.json({ error: "We couldn't find that request." }, { status: 404 });
  const limited = await throttle(request, [["email", accountId, "support_reply", { max: 30, windowMs: 60 * 60 * 1000, label: "replies" }]]);
  if (limited) return limited;
  const b = await request.json().catch(() => ({}));
  if (!b.body?.trim()) return NextResponse.json({ error: "Write a message first." }, { status: 400 });
  const now = new Date().toISOString();
  await identityDb.prepare("INSERT INTO support_messages (id, ticket_id, kind, author_id, body, created_at) VALUES (?,?,?,?,?,?)").run(crypto.randomUUID(), id, "user", accountId, b.body.trim().slice(0, 4000), now);
  await identityDb.prepare("UPDATE support_tickets SET status = 'open', resolved_at = NULL, updated_at = ? WHERE id = ?").run(now, id);
  return NextResponse.json({ ok: true });
}
