import { bypassesGates, roleTierGrant, bestTier } from "./admin/roles.js";
// Basic/Plus/Pro capability rules for Vent Rooms — kept separate from
// lib/identity/rate-limit.js's TIERED_DAILY_LIMITS since this is a plain
// yes/no capability check, not a rolling-window counter.
//   basic: can join a room, can't start one
//   plus:  can join a room, can't start one
//   pro:   can join and start
export const VENT_ACCESS = {
  basic: { canJoin: true, canCreate: false },
  plus: { canJoin: true, canCreate: false },
  pro: { canJoin: true, canCreate: true },
};

export function canJoinVent(tier) {
  return VENT_ACCESS[tier]?.canJoin ?? false;
}

export function canCreateVent(tier) {
  return VENT_ACCESS[tier]?.canCreate ?? false;
}

// Requirements to buy Plus or Pro: a verified email AND a verified phone
// (both done in Settings). Enforced server-side in both the real Stripe
// checkout route — not just shown in the UI — so it can't be bypassed by
// calling the API directly.
export function missingUpgradeRequirements(account) {
  const missing = [];
  if (bypassesGates(account?.role)) return missing; // staff testing the prototype
  if (!account?.emailVerified) missing.push("email");
  if (!account?.phoneVerified) missing.push("phone");
  return missing;
}

export function requirementsMessage(missing) {
  const label = missing.map((m) => (m === "email" ? "email address" : "phone number")).join(" and ");
  return `Verify your ${label} in Settings before upgrading.`;
}

// Staff with gate-bypass act as Pro everywhere a plan is checked (Vent access,
// page allowances, daily AI caps) so every feature can be exercised in testing.
export function effectiveTier(account) {
  // A staff role can grant a plan (lib/admin/rbac.js); the higher of the role grant and the paid plan wins.
  // A paying account whose tier column was never set is treated as PRO, matching the migration in lib/identity/db.js.
  const paid = account?.premiumTier && account.premiumTier !== "basic" ? account.premiumTier : account?.isPremium ? "pro" : "basic";
  if (bypassesGates(account?.role)) return "pro";
  const grant = roleTierGrant(account?.role);
  return grant ? bestTier(grant, paid) : paid;
}


// ---------------------------------------------------------------------------
// Messaging perks per plan. ONE source of truth: the server enforces these and
// the plan table reads from them, so what is promised is what is delivered.
//   OUT      normal messaging; can request people already in their network
//   OUT+     more requests/day; can message people outside their network
//   OUT PRO  priority requests, higher limits, analytics, AI-assisted outreach
// "Network" = you follow them or they follow you, or you already have a chat.
// ---------------------------------------------------------------------------
export const MESSAGING = {
  // voiceNotes / fileSharing are OUT+ and OUT PRO only. stickers (like GIFs) are open to every plan.
  basic: { requestsPerDay: 5,  outsideNetwork: false, priority: false, messagesPerDay: 200,  maxLen: 4000, requestMaxLen: 300, analytics: false, aiOutreach: false, stickers: true, voiceNotes: false, voiceNoteMaxSeconds: 0,   fileSharing: false, fileMaxMB: 0 },
  plus:  { requestsPerDay: 20, outsideNetwork: true,  priority: false, messagesPerDay: 200,  maxLen: 4000, requestMaxLen: 300, analytics: false, aiOutreach: false, stickers: true, voiceNotes: true,  voiceNoteMaxSeconds: 180, fileSharing: true,  fileMaxMB: 25 },
  pro:   { requestsPerDay: 60, outsideNetwork: true,  priority: true,  messagesPerDay: 1000, maxLen: 8000, requestMaxLen: 600, analytics: true,  aiOutreach: true,  stickers: true, voiceNotes: true,  voiceNoteMaxSeconds: 600, fileSharing: true,  fileMaxMB: 100 },
};
export const messagingFor = (tier) => MESSAGING[tier] || MESSAGING.basic;


// ---------------------------------------------------------------------------
// Plans: names, prices and the capability table. ONE source of truth. The
// server enforces these (routes call `can*`/`*For` below) and the plan page and
// native app read the same numbers, so what is promised is what is delivered.
//   OUT       Speak        generously free — network growth and storytelling
//   OUT+      Understand   depth and convenience, never the right to speak
//   OUT PRO   Investigate  analysis, research, creator and community tools
// Principle: reading Stories, creating Stories and seeing company patterns are
// free on every plan. Paid plans buy synthesis, analytics and convenience.
// ---------------------------------------------------------------------------
export const PLANS = {
  basic: { name: "OUT",     tagline: "Speak",       monthly: 0,     annual: 0,       annualMonthly: 0 },
  plus:  { name: "OUT+",    tagline: "Understand",  monthly: 14.99, annual: 158.29,  annualMonthly: 13.19 },
  pro:   { name: "OUT PRO", tagline: "Investigate", monthly: 34.99, annual: 369.49,  annualMonthly: 30.79 },
};
export const BUSINESS_PLANS = {
  business:     { name: "Business",     monthly: 199,  annual: 2101.44, annualMonthly: 175.12 },
  business_pro: { name: "Business Pro", monthly: 499,  annual: 5269.44, annualMonthly: 439.12 },
  enterprise:   { name: "Enterprise",   monthly: null, annual: null,    annualMonthly: null, custom: true },
};

// Server-enforced capability flags and limits per tier.
export const STORY_PERKS = {
  basic: { aliases: 3,  trackedStories: 5, savedSearches: 0, circlesCreate: 0, circleMembersMax: 0, exports: false,        aiStoryAssistant: false, identityRisk: false, summaries: false, companyIntel: false, deepDive: false, patternExplorer: false, scheduledPublishing: false, creatorAnalytics: false, hostRooms: false },
  plus:  { aliases: 10, trackedStories: Infinity, savedSearches: 5, circlesCreate: 1, circleMembersMax: 500, exports: false, aiStoryAssistant: true,  identityRisk: true,  summaries: true,  companyIntel: true,  deepDive: false, patternExplorer: false, scheduledPublishing: true,  creatorAnalytics: false, hostRooms: false },
  pro:   { aliases: 30, trackedStories: Infinity, savedSearches: 25, circlesCreate: 5, circleMembersMax: 5000, exports: true, aiStoryAssistant: true,  identityRisk: true,  summaries: true,  companyIntel: true,  deepDive: true,  patternExplorer: true,  scheduledPublishing: true,  creatorAnalytics: true,  hostRooms: true },
};
export const perksFor = (tier) => STORY_PERKS[tier] || STORY_PERKS.basic;
export const planName = (tier) => (PLANS[tier] || PLANS.basic).name;

// Business plans (companies, not individuals). Principle that never changes: a business
// plan buys INSIGHT and RESPONSE tools. It never buys removal, hiding, editing, ranking or
// the identity of authors. Right of reply itself is free for every verified company.
import { has, advanced, SEATS, ALERT_RULES_MAX } from "./business-features.js";
// Derived from lib/business-features.js (the single source of truth for company plans). The flat
// flags below are kept so older callers keep working; new code should use `has()` / `levelOf()`.
const perksOf = (plan) => ({
  insights: has(plan, "insights"), benchmark: has(plan, "benchmarks"), alerts: has(plan, "alerts"),
  reps: SEATS[plan] || 1, exports: has(plan, "csv"), priorityReview: has(plan, "priority_review"),
  alertRules: ALERT_RULES_MAX[plan] || 0,
});
export const BUSINESS_PERKS = Object.fromEntries(["none", "business", "business_pro", "enterprise"].map((p) => [p, perksOf(p)]));
export const businessPerks = (plan) => BUSINESS_PERKS[plan] || BUSINESS_PERKS.none;


// ---------------------------------------------------------------------------
// Plan comparison as the USER sees it (web + native plan pages).
// Principle: the UI never shows numbers for limits. It shows a relative level
// ("Light" < "Extended" < "Highest") and the real numbers live ONLY on the
// server (TIERED_DAILY_LIMITS in lib/identity/rate-limit.js, MESSAGING and
// STORY_PERKS above). `backend` names where each row's real number comes from
// so the admin dashboard (Billing > Plan limits) can show UI vs backend side
// by side. Values: true = included, false = not included, string = level.
// ---------------------------------------------------------------------------
export const PLAN_COMPARISON = [
  { title: "Stories (free for everyone to read and tell)", rows: [
    { label: "Read all stories and company patterns", values: [true, true, true] },
    { label: "Share Stories, anonymously if you like", values: [true, true, true] },
    { label: "“This happened to me too” and story updates", values: [true, true, true] },
    { label: "Automatic redaction of emails, phones, IDs", values: [true, true, true] },
    { label: "Private drafts", values: [true, true, true] },
    { label: "Track stories", values: ["Light", "Extended", "Extended"], backend: "perk:trackedStories" },
    { label: "Identity-risk warnings", values: [false, true, true] },
    { label: "AI Story Assistant", values: [false, "Light", "Extended"], backend: "tiered:story_assist" },
    { label: "Scheduled publishing", values: [false, true, true] },
  ] },
  { title: "Understand (company and market insight)", rows: [
    { label: "AI “what people are saying” summaries", values: [false, "Light", "Extended"], backend: "tiered:story_summary" },
    { label: "Reality Translator, glossary", values: [true, true, true] },
    { label: "Reality Translator, AI for any text", values: [false, "Light", "Extended"], backend: "tiered:speak_translate" },
    { label: "Company Deep Dive", values: [false, false, true], backend: "tiered:deep_dive" },
    { label: "Pattern Explorer (ask questions of the stories)", values: [false, false, true], backend: "tiered:deep_dive" },
    { label: "Saved searches and alerts", values: [false, "Light", "Extended"], backend: "perk:savedSearches" },
    { label: "Start a Support Circle", values: [false, "Light", "Extended"], backend: "perk:circlesCreate" },
    { label: "Employment verification badge", values: [true, true, true] },
    { label: "Creator analytics and exports", values: [false, false, true] },
    { label: "Host a Story Room", values: [false, false, true] },
  ] },
  { title: "Core", rows: [
    { label: "Ad-free feed", values: [false, true, true] },
    { label: "Humble Brag Translator", values: ["Light", "Extended", "Highest"], backend: "tiered:translate" },
    { label: "Resume Roast AI", values: [false, "Light", "Extended"], backend: "tiered:resume_roast" },
    { label: "Join Vent Rooms", values: [true, true, true] },
    { label: "Start Vent Rooms", values: [false, false, true] },
    { label: "Verified tick", values: [false, "Plus tick", "Pro tick"] },
  ] },
  { title: "Professional visibility", rows: [
    { label: "Profile visibility boost", values: ["Normal", "Increased discovery", "Significantly increased"] },
    { label: "Who viewed your profile", values: ["None", "Limited", "Full"] },
    { label: "Profile analytics", values: [false, "Basic", "Full"] },
  ] },
  { title: "Messaging", rows: [
    { label: "Priority messages", values: [false, false, true] },
    { label: "Message requests", values: ["Standard", "Higher", "Highest"], backend: "msg:requestsPerDay" },
    { label: "Message people outside your network", values: ["Network only", true, true] },
    { label: "Daily message allowance", values: ["Standard", "Standard", "Raised"], backend: "msg:messagesPerDay" },
    { label: "Message analytics", values: [false, false, true] },
    { label: "Stickers and GIFs in chats", values: [true, true, true], backend: "msg:stickers", bool: true },
    { label: "Voice notes", values: [false, true, true], backend: "msg:voiceNotes", bool: true },
    { label: "File sharing", values: [false, true, true], backend: "msg:fileSharing", bool: true },
    { label: "AI-assisted outreach", values: [false, false, true], backend: "tiered:ai_outreach" },
  ] },
];
