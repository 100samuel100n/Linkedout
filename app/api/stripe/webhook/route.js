import { setCompanyPlan } from "@/lib/stories/business";
import { businessPlanForPriceId } from "@/lib/stripe";
import { identityDb } from "@/lib/identity/db";
import { NextResponse } from "next/server";
import { getStripe, getWebhookSecret, tierForPriceId } from "@/lib/stripe";
import { getAccountByStripeCustomerId, applyStripeSubscriptionEvent } from "@/lib/identity/service";

// Stripe webhook endpoint. This is the ONLY place premium_tier ever gets
// set based on real payment state — never from a client-triggered route.
// Point your Stripe webhook (or `stripe listen --forward-to`) at
// POST /api/stripe/webhook with these events enabled:
//   checkout.session.completed, customer.subscription.updated,
//   customer.subscription.deleted
export async function POST(request) {
  let stripe;
  let webhookSecret;
  try {
    stripe = getStripe();
    webhookSecret = getWebhookSecret();
  } catch (e) {
    console.error("Stripe webhook received but Stripe isn't configured:", e.message);
    return NextResponse.json({ error: e.message }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  const rawBody = await request.text();

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (e) {
    console.error("Stripe webhook signature verification failed:", e.message);
    return NextResponse.json({ error: `Webhook signature verification failed: ${e.message}` }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.metadata?.kind === "business" && session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          const price = sub.items?.data?.[0]?.price;
          await setCompanyPlan({ companyId: session.metadata.companyId, plan: businessPlanForPriceId(price?.id) || session.metadata.plan, status: ["active", "trialing"].includes(sub.status) ? "active" : "inactive", interval: price?.recurring?.interval === "year" ? "year" : "month", customerId: String(sub.customer), subscriptionId: sub.id, periodEnd: bizEnd(sub) });
          break;
        }
        const accountId = session.client_reference_id || session.metadata?.accountId;
        if (accountId && session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(session.subscription);
          const priceId = subscription.items?.data?.[0]?.price?.id;
          const tier = tierForPriceId(priceId) || session.metadata?.tier || null;
          await applyStripeSubscriptionEvent({ accountId, subscriptionId: subscription.id, status: subscription.status, tier });
          await setInterval(accountId, subscription);
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        if (subscription.metadata?.kind === "business") {
          const price = subscription.items?.data?.[0]?.price;
          const live = ["active", "trialing"].includes(subscription.status) && event.type !== "customer.subscription.deleted";
          await setCompanyPlan({ companyId: subscription.metadata.companyId, plan: live ? (businessPlanForPriceId(price?.id) || subscription.metadata.plan) : "none", status: live ? "active" : "inactive", interval: price?.recurring?.interval === "year" ? "year" : "month", subscriptionId: subscription.id, periodEnd: bizEnd(subscription) });
          break;
        }
        const account = await getAccountByStripeCustomerId(subscription.customer);
        if (account) {
          const priceId = subscription.items?.data?.[0]?.price?.id;
          const tier = tierForPriceId(priceId);
          await applyStripeSubscriptionEvent({ accountId: account.id, subscriptionId: subscription.id, status: subscription.status, tier });
          await setInterval(account.id, subscription);
        }
        break;
      }
      default:
        // Unhandled event types are fine to ignore — Stripe expects a 200
        // for anything we don't act on, not an error.
        break;
    }
  } catch (e) {
    console.error(`Stripe webhook handler failed for ${event.type}:`, e.message);
    return NextResponse.json({ error: "Webhook handler failed." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// Period end differs by API version (subscription vs item level); read either.
function bizEnd(sub) {
  const t = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
  return t ? new Date(t * 1000).toISOString() : null;
}
// Remember whether an individual subscription is monthly or annual (revenue reporting).
async function setInterval(accountId, sub) {
  try {
    const i = sub.items?.data?.[0]?.price?.recurring?.interval === "year" ? "year" : "month";
    await identityDb.prepare("UPDATE accounts SET premium_interval = ? WHERE id = ?").run(i, accountId);
  } catch { /* column is created lazily by the Stories identity migration */ }
}
