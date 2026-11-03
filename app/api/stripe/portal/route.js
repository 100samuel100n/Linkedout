import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { getAccountById } from "@/lib/identity/service";
import { getStripe, isStripeConfigured, getAppUrl } from "@/lib/stripe";

// Creates a Stripe Billing Portal session so a subscriber can update
// payment details or cancel.
export async function POST() {
  const accountId = await getCurrentAccountId();
  if (!accountId) {
    return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });
  }
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe isn't configured yet.", code: "STRIPE_NOT_CONFIGURED" }, { status: 503 });
  }

  const account = await getAccountById(accountId);
  if (!account?.stripeCustomerId) {
    return NextResponse.json({ error: "No billing account on file yet — upgrade first." }, { status: 400 });
  }

  try {
    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: account.stripeCustomerId,
      return_url: `${getAppUrl()}/premium`,
    });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error("Stripe billing portal session creation failed:", e.message);
    return NextResponse.json({ error: "Could not open the billing portal. Please try again." }, { status: 502 });
  }
}
