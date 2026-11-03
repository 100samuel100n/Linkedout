import { NextResponse } from "next/server";
import { identityDb } from "@/lib/identity/db";
import { throttle } from "@/lib/identity/throttle-http";

// Public intake for legal / government / law-enforcement requests. Staff with
// the `legal` role see them in Legal & Gov Requests; nothing is auto-complied.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TYPES = new Set(["subpoena", "court_order", "preservation", "emergency", "data_request", "other"]);
export async function POST(request) {
  const limited = await throttle(request, [["ip", null, "public_legal", { max: 5, windowMs: 60 * 60 * 1000, label: "submissions" }]]);
  if (limited) return limited;
  const b = await request.json().catch(() => ({}));
  if (b.website) return NextResponse.json({ ok: true, reference: "ok" });
  const t = (k, n) => String(b[k] ?? "").trim().slice(0, n);
  const agency = t("agency", 200), name = t("name", 120), email = t("email", 200), type = TYPES.has(b.type) ? b.type : "other", subject = t("subject", 300), details = t("details", 5000), ref = t("reference", 120);
  const deadline = /^\d{4}-\d{2}-\d{2}$/.test(t("deadline", 10)) ? t("deadline", 10) : null;
  if (!agency || !name || !EMAIL.test(email) || !subject || !details) return NextResponse.json({ error: "Agency, your name, a valid official email, a subject and the details are required." }, { status: 400 });
  if (!b.authorized) return NextResponse.json({ error: "Please confirm you're authorized to make this request." }, { status: 400 });
  const id = crypto.randomUUID();
  await identityDb.prepare("INSERT INTO legal_requests (id, agency, type, subject, deadline, requester_name, requester_email, reference, details, source, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, agency, type, subject, deadline, name, email, ref || null, details, "public", new Date().toISOString());
  return NextResponse.json({ ok: true, reference: id.slice(0, 8).toUpperCase() });
}
