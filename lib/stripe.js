// Stripe client. Deliberately lazy — this module is imported by routes that
// run at build time too (Next.js collects route metadata during `next
// build`), and we don't want a missing STRIPE_SECRET_KEY to break the build.
// The error only surfaces when a Stripe call is actually attempted, with a
// message that says exactly what's missing.
import Stripe from "stripe";
export { getAppUrl } from "./config.js";

let _stripe = null;

export function getStripe() {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    const err = new Error(
      "STRIPE_SECRET_KEY is not set. Add it to .env.local (see README § Stripe setup) to enable real checkout."
    );
    err.code = "STRIPE_NOT_CONFIGURED";
    throw err;
  }
  _stripe = new Stripe(key, { apiVersion: "2024-06-20" });
  return _stripe;
}

// Two real paid tiers — Plus and Pro — each its own Stripe Price. Basic
// is free and never touches Stripe at all.
export function isStripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PLUS_PRICE_ID && process.env.STRIPE_PRO_PRICE_ID);
}

// Each paid tier has a MONTHLY and an ANNUAL Stripe Price (same product).
//   OUT+     $14.99/mo   or $158.29/yr   (STRIPE_PLUS_PRICE_ID / STRIPE_PLUS_ANNUAL_PRICE_ID)
//   OUT PRO  $34.99/mo   or $369.49/yr   (STRIPE_PRO_PRICE_ID  / STRIPE_PRO_ANNUAL_PRICE_ID)
// Annual is optional until you create the annual Prices — checkout for "annual" says what's missing.
const TIER_ENV_KEYS = {
  plus: { month: "STRIPE_PLUS_PRICE_ID", year: "STRIPE_PLUS_ANNUAL_PRICE_ID" },
  pro: { month: "STRIPE_PRO_PRICE_ID", year: "STRIPE_PRO_ANNUAL_PRICE_ID" },
};

export function isAnnualConfigured() {
  return Boolean(process.env.STRIPE_PLUS_ANNUAL_PRICE_ID && process.env.STRIPE_PRO_ANNUAL_PRICE_ID);
}

export function getPriceId(tier, interval = "month") {
  const envKey = TIER_ENV_KEYS[tier]?.[interval === "year" ? "year" : "month"];
  if (!envKey) throw new Error(`getPriceId: unknown tier "${tier}" (expected "plus" or "pro").`);
  const priceId = process.env[envKey];
  if (!priceId) {
    const err = new Error(`${envKey} is not set. Add the ${tier} plan's Price ID to .env.local.`);
    err.code = "STRIPE_NOT_CONFIGURED";
    throw err;
  }
  return priceId;
}

// Resolves a Stripe Price ID back to our tier name — used by the webhook
// handler, which only knows a subscription's price id, not which of our
// tiers that corresponds to. Returns null for a price id that matches
// neither (defensive — shouldn't happen with a correctly configured
// webhook, but a null here becoming "basic" downstream is much safer
// than accidentally granting Pro).
export function tierForPriceId(priceId) {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PLUS_PRICE_ID || priceId === process.env.STRIPE_PLUS_ANNUAL_PRICE_ID) return "plus";
  if (priceId === process.env.STRIPE_PRO_PRICE_ID || priceId === process.env.STRIPE_PRO_ANNUAL_PRICE_ID) return "pro";
  return null;
}

export function getWebhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    const err = new Error("STRIPE_WEBHOOK_SECRET is not set. Add it to .env.local (see README § Stripe setup).");
    err.code = "STRIPE_NOT_CONFIGURED";
    throw err;
  }
  return secret;
}

// ---- Business plans (a company page subscribes, not a person) ----
const BIZ_ENV = {
  business: { month: "STRIPE_BUSINESS_PRICE_ID", year: "STRIPE_BUSINESS_ANNUAL_PRICE_ID" },
  business_pro: { month: "STRIPE_BUSINESS_PRO_PRICE_ID", year: "STRIPE_BUSINESS_PRO_ANNUAL_PRICE_ID" },
};
export function businessPriceId(plan, interval = "month") {
  const k = BIZ_ENV[plan]?.[interval === "year" ? "year" : "month"];
  const v = k && process.env[k];
  if (!v) throw new Error(`${k || plan} is not set.`);
  return v;
}
export function businessPlanForPriceId(id) {
  if (!id) return null;
  for (const [plan, e] of Object.entries(BIZ_ENV)) if (id === process.env[e.month] || id === process.env[e.year]) return plan;
  return null;
}
