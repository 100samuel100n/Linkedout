import { NextResponse } from "next/server";
import { getStripe, isStripeConfigured, businessPriceId, getAppUrl } from "@/lib/stripe";
import { assertOwner } from "@/lib/stories/business";
import { requireViewer, json, fail } from "@/lib/stories/http";

// Checkout for a Business / Business Pro plan. The PAYING ENTITY is the company page; it must be
// verified, and only its owner can buy. Enterprise is a conversation (see /api/business/enterprise).
export async function POST(request) {
  const v = await requireViewer(); if (v.error) return v.error;
  const b = await request.json().catch(() => ({}));
  if (!["business", "business_pro"].includes(b.plan)) return json({ error: "Choose Business or Business Pro. Enterprise is by contact." }, 400);
  const interval = b.interval === "year" ? "year" : "month";
  if (!isStripeConfigured()) return json({ error: "Billing isn't configured yet.", code: "STRIPE_NOT_CONFIGURED" }, 503);
  try {
    const c = await assertOwner(b.companyId, v.key);
    const { contentDb } = await import("@/lib/content/db");
    const row = await contentDb.prepare("SELECT verification FROM companies WHERE id = ?").get(c.id);
    if (row.verification !== "verified") return json({ error: "Verify your company page first, then you can subscribe.", code: "NOT_VERIFIED" }, 403);
    const stripe = getStripe(); const app = getAppUrl();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription", customer_email: v.account?.email, client_reference_id: `company:${c.id}`,
      line_items: [{ price: businessPriceId(b.plan, interval), quantity: 1 }],
      metadata: { kind: "business", companyId: c.id, plan: b.plan, interval },
      subscription_data: { metadata: { kind: "business", companyId: c.id, plan: b.plan } },
      success_url: `${app}/companies/${c.id}/business?status=success`, cancel_url: `${app}/companies/${c.id}/business?status=cancelled`,
    });
    return json({ url: session.url });
  } catch (e) { return fail(e); }
}
