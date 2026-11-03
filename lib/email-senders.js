// Sender identities by email CATEGORY. Mixing password resets, receipts, newsletters and activity digests under one
// "From" hurts deliverability (spam filters judge each stream separately) and looks unprofessional. Each category gets
// its own display name, address and reply-to; marketing-style streams also get unsubscribe headers.
//
// Setup (any one of these):
//   1. EMAIL_DOMAIN=linkedout.app   -> security@, hello@, notifications@, support@, billing@, business@, legal@, news@, updates@, alerts@
//      (verify the DOMAIN once in Resend; you do not need mailboxes for addresses that only send)
//   2. EMAIL_FROM_SECURITY="LinkedOut Security <security@your-domain>"  (per-category override; same for the others)
//   3. nothing but RESEND_FROM_EMAIL: every category still gets its own display name, from that one address (today's behaviour)
// Replies: EMAIL_REPLY_SUPPORT=help@your-inbox.com etc. (a real inbox people can answer to; sending addresses can stay no-reply)
export const EMAIL_CATEGORIES = {
  security:      { name: "LinkedOut Security",          local: "security",      reply: "support", use: "Email verification, password reset, sign-in codes, new-device alerts, account-deletion codes, staff login codes" },
  account:       { name: "LinkedOut",                   local: "hello",         reply: "support", use: "Welcome and onboarding" },
  notifications: { name: "LinkedOut",                   local: "notifications", reply: null,      use: "Reactions, comments, Me-too, mentions, message and room activity, digests", list: true },
  support:       { name: "LinkedOut Support",           local: "support",       reply: "support", use: "Ticket received/replied, appeal decisions, verification review outcomes" },
  billing:       { name: "LinkedOut Billing",           local: "billing",       reply: "billing", use: "Receipts, plan changes, failed payments, refunds, advertiser invoices" },
  business:      { name: "LinkedOut for Business",      local: "business",      reply: "business", use: "Company registration and domain codes, business verification, ads review decisions" },
  legal:         { name: "LinkedOut Legal",             local: "legal",         reply: "legal",   use: "DMCA acknowledgements, legal requests, policy/terms changes" },
  news:          { name: "LinkedOut News",              local: "news",          reply: "support", use: "Product announcements and newsletters (marketing)", list: true },
  service:       { name: "LinkedOut Service Updates",   local: "updates",       reply: "support", use: "Outages, maintenance, important service notices" },
  alerts:        { name: "LinkedOut Staff Alerts",      local: "alerts",        reply: null,      use: "Security alerts and incident notices to staff" },
};
const bareAddress = (s) => (String(s || "").match(/<([^>]+)>/)?.[1] || String(s || "")).trim();
export function emailConfigured() { return Boolean(process.env.RESEND_API_KEY && (process.env.RESEND_FROM_EMAIL || process.env.EMAIL_DOMAIN)); }
export function senderFor(category = "notifications") {
  const def = EMAIL_CATEGORIES[category] || EMAIL_CATEGORIES.notifications, up = category.toUpperCase();
  const domain = process.env.EMAIL_DOMAIN, fallback = bareAddress(process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev");
  const from = process.env[`EMAIL_FROM_${up}`] || `${def.name} <${domain ? `${def.local}@${domain}` : fallback}>`;
  const reply = process.env[`EMAIL_REPLY_${(def.reply || "").toUpperCase()}`] || process.env.EMAIL_REPLY_TO || undefined;
  const base = process.env.APP_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || "";
  const headers = def.list ? { "List-Unsubscribe": `<${base}/settings#notifications>` } : undefined;
  return { from, replyTo: def.reply === null ? undefined : reply, headers };
}
// Which category a transactional email belongs to, from its log label.
export function categoryFromLabel(label = "") {
  if (label === "welcome") return "account";
  if (/^(email verification|password reset|account-|staff-login-code|new-signin|notification:security)/.test(label)) return "security";
  if (/^(company-|employment-code|business-)/.test(label)) return "business";
  if (/^support-inbox-alert/.test(label)) return "alerts";
  if (/^support-|^appeal-|^verification-/.test(label)) return "support";
  if (/^(billing|receipt|payment)/.test(label)) return "billing";
  if (/^legal-|^dmca/.test(label)) return "legal";
  return "notifications";
}
