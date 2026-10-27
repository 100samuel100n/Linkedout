import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { identityDb } from "@/lib/identity/db";
import { throttle } from "@/lib/identity/throttle-http";

import { SUPPORT_CATEGORY_KEYS as CATEGORIES, HIGH_PRIORITY } from "@/lib/support-categories";

// Your own support tickets (Help & Support in Settings, web + native).
export async function GET() {
  const id = await getCurrentAccountId();
  if (!id) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });
  const rows = await identityDb.prepare("SELECT id, subject, category, status, created_at, updated_at FROM support_tickets WHERE account_id = ? ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 100").all(id);
  return NextResponse.json({ tickets: rows.map((t) => ({ id: t.id, ref: "T-" + t.id.slice(0, 6).toUpperCase(), subject: t.subject, category: t.category, status: t.status, createdAt: t.created_at, updatedAt: t.updated_at || t.created_at })) });
}

export async function POST(request) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });
  const limited = await throttle(request, [["email", accountId, "support_new", { max: 5, windowMs: 60 * 60 * 1000, label: "support requests" }]]);
  if (limited) return limited;
  const b = await request.json().catch(() => ({}));
  if (!b.subject?.trim() || !b.body?.trim()) return NextResponse.json({ error: "Please add a subject and describe the problem." }, { status: 400 });
  const category = CATEGORIES.includes(b.category) ? b.category : "general";
  const id = crypto.randomUUID(), now = new Date().toISOString();
  // Billing / safety issues start at higher priority so they surface first in the queue.
  const priority = HIGH_PRIORITY.has(category) ? "high" : "normal";
  await identityDb.prepare("INSERT INTO support_tickets (id, account_id, subject, body, category, priority, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(id, accountId, b.subject.trim().slice(0, 140), b.body.trim().slice(0, 4000), category, priority, now, now);
  return NextResponse.json({ ok: true, id, ref: "T-" + id.slice(0, 6).toUpperCase() });
}
