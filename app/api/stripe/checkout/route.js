import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { getAccountById, setStripeCustomerId } from "@/lib/identity/service";
import { getStripe, isStripeConfigured, getPriceId, getAppUrl } from "@/lib/stripe";
import { missingUpgradeRequirements, requirementsMessage } from "@/lib/tiers";

const VALID_TIERS = new Set(["plus", "pro"]);

// Creates a Stripe Checkout Session for the requested paid tier (Plus or
// Pro) and returns its URL for the client to redirect to. Does NOT set
// the account's tier itself — that only happens once Stripe confirms
// payment, via the webhook handler (app/api/stripe/webhook/route.js).
export async function POST(request) {
  const accountId = await getCurrentAccountId();
  if (!accountId) {
    return NextResponse.json({ error: "You need to be logged in to upgrade." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const tier = body?.tier;
  const interval = body?.interval === "year" ? "year" : "month";
  if (!VALID_TIERS.has(tier)) {
    return NextResponse.json({ error: 'tier must be "plus" or "pro".' }, { status: 400 });
  }

  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Stripe isn't configured yet. Add STRIPE_SECRET_KEY, STRIPE_PLUS_PRICE_ID, and STRIPE_PRO_PRICE_ID to .env.local (see README § Stripe setup).", code: "STRIPE_NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  const account = await getAccountById(accountId);
  if (!account) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  const missing = missingUpgradeRequirements(account);
  if (missing.length > 0) {
    return NextResponse.json({ error: requirementsMessage(missing), code: "VERIFICATION_REQUIRED", missing }, { status: 403 });
  }

  try {
    const stripe = getStripe();
    const appUrl = getAppUrl();

    let customerId = account.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: account.email,
        name: account.realName,
        metadata: { accountId },
      });
      customerId = customer.id;
      await setStripeCustomerId(accountId, customerId);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: accountId,
      line_items: [{ price: getPriceId(tier, interval), quantity: 1 }],
      success_url: `${appUrl}/premium?checkout=success`,
      cancel_url: `${appUrl}/premium?checkout=cancelled`,
      metadata: { accountId, tier, interval },
    });

    return NextResponse.json({ url: session.url });
  } catch (e) {
    if (e.code === "STRIPE_NOT_CONFIGURED") {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 503 });
    }
    console.error("Stripe checkout session creation failed:", e.message);
    return NextResponse.json({ error: "Could not start checkout. Please try again." }, { status: 502 });
  }
}
