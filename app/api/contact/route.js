import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { getAccountById } from "@/lib/identity/service";
import { identityDb } from "@/lib/identity/db";
import { throttle } from "@/lib/identity/throttle-http";
import { SUPPORT_CATEGORY_KEYS, HIGH_PRIORITY } from "@/lib/support-categories";
import { sendSupportReceivedEmail, sendSupportInboxAlert } from "@/lib/email";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Public "Contact us": works for visitors with no account and for logged-in people alike.
// Logged-in people get the ticket on their account (and its thread); visitors get an email reply.
export async function POST(request) {
  const b = await request.json().catch(() => ({}));
  // Hidden field real people never fill in. Pretend it worked so bots learn nothing.
  if (b.website) return NextResponse.json({ ok: true, ref: "T-000000" });

  const accountId = await getCurrentAccountId();
  const limited = await throttle(request, [
    ["ip", null, "contact_ip", { max: 6, windowMs: 60 * 60 * 1000, label: "messages from this connection" }],
    ...(accountId ? [["email", accountId, "contact_acct", { max: 6, windowMs: 60 * 60 * 1000, label: "support requests" }]] : []),
  ]);
  if (limited) return limited;

  const account = accountId ? await getAccountById(accountId) : null;
  const email = String((account?.email || b.email || "")).trim().toLowerCase();
  const name = String(b.name || account?.realName || "").trim().slice(0, 80);
  const subject = String(b.subject || "").trim().slice(0, 140);
  const body = String(b.body || "").trim().slice(0, 4000);
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "Enter an email address we can reply to." }, { status: 400 });
  if (!subject || !body) return NextResponse.json({ error: "Please add a subject and a message." }, { status: 400 });
  if (body.length < 10) return NextResponse.json({ error: "Tell us a little more so we can help." }, { status: 400 });

  const category = SUPPORT_CATEGORY_KEYS.includes(b.category) ? b.category : "general";
  const id = crypto.randomUUID(), now = new Date().toISOString();
  const ref = "T-" + id.slice(0, 6).toUpperCase();
  await identityDb.prepare(
    "INSERT INTO support_tickets (id, account_id, subject, body, category, priority, contact_name, contact_email, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
  ).run(id, accountId || null, subject, body, category, HIGH_PRIORITY.has(category) ? "high" : "normal", name || null, email, "contact", now, now);

  // Email failures never lose the message: it is already saved on the ticket.
  await Promise.allSettled([
    sendSupportReceivedEmail(email, name, ref, subject),
    sendSupportInboxAlert(ref, { name, email, category, subject, body }),
  ]);
  return NextResponse.json({ ok: true, id: accountId ? id : undefined, ref });
}
