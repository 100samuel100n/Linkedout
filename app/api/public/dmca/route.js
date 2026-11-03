import { NextResponse } from "next/server";
import { identityDb } from "@/lib/identity/db";
import { throttle } from "@/lib/identity/throttle-http";

// Public DMCA takedown intake (no login). Lands in the admin Copyright / DMCA
// queue with source = 'public'. Requires the statutory statements; throttled
// per IP; a hidden "website" field catches simple bots.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export async function POST(request) {
  const limited = await throttle(request, [["ip", null, "public_dmca", { max: 5, windowMs: 60 * 60 * 1000, label: "submissions" }]]);
  if (limited) return limited;
  const b = await request.json().catch(() => ({}));
  if (b.website) return NextResponse.json({ ok: true, reference: "ok" }); // honeypot
  const t = (k, n) => String(b[k] ?? "").trim().slice(0, n);
  const name = t("name", 120), email = t("email", 200), work = t("work", 3000), url = t("url", 500), details = t("details", 3000), signature = t("signature", 120);
  if (!name || !EMAIL.test(email) || !work || !url || !signature) return NextResponse.json({ error: "Name, a valid email, the copyrighted work, the infringing link and a signature are required." }, { status: 400 });
  if (!b.goodFaith || !b.accurate) return NextResponse.json({ error: "You must confirm both statements to file a notice." }, { status: 400 });
  const postId = url.match(/\/post\/([A-Za-z0-9-]{8,64})/)?.[1] || null;
  const id = crypto.randomUUID();
  await identityDb.prepare("INSERT INTO dmca_notices (id, claimant, claimant_email, target_post_id, target_url, work_description, description, signature, source, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(id, name, email, postId, url, work, details, signature, "public", new Date().toISOString());
  return NextResponse.json({ ok: true, reference: id.slice(0, 8).toUpperCase() });
}
