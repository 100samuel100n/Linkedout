// Company plans: ONE source of truth for what each plan includes.
// The server enforces these (lib/stories/company-suite.js calls `has()` / `levelOf()`), and the
// pre-purchase comparison table renders the very same list — what is promised is what is delivered.
//
// Principle that never changes: a business plan buys INSIGHT, RESPONSE and EMPLOYER tools.
// It never buys removal, hiding, editing, ranking, or the identity of any author.
//
// Columns: [Verified (free), Business, Business Pro, Enterprise]
// Values:  false | true | "basic" | "advanced" | "custom" | number | short string
// status:  "live" = shipped; "soon" = on the roadmap. The table says so plainly, so nobody buys vapourware.

export const PLAN_KEYS = ["none", "business", "business_pro", "enterprise"];
export const PLAN_LABELS = { none: "Verified (free)", business: "Business", business_pro: "Business Pro", enterprise: "Enterprise" };

export const PILLARS = [
  { key: "reputation",   label: "Reputation",        question: "What are people saying about us?" },
  { key: "response",     label: "Response",          question: "How do we respond and communicate?" },
  { key: "intelligence", label: "Intelligence",      question: "What patterns should we know about?" },
  { key: "improvement",  label: "Improvement",       question: "What should we actually fix?" },
  { key: "employer",     label: "Employer & talent", question: "How do we show we're a good place to work?" },
  { key: "team",         label: "Team & security",   question: "Who can do what, and how is it controlled?" },
];

const L = (label, pillar, levels, extra = {}) => ({ label, pillar, levels, status: "live", ...extra });

export const FEATURES = {
  // ---- Reputation -------------------------------------------------------------------------
  verified_page:     L("Verified company page", "reputation", [true, true, true, true]),
  reputation_public: L("Public reputation health and response label", "reputation", ["public", true, true, true]),
  reputation_trends: L("Reputation trends and permanent history", "reputation", [false, true, true, true]),
  what_changed:      L("“What changed this month”", "reputation", [false, true, true, true]),
  badges:            L("Earned recognition badges (never purchased)", "reputation", [true, true, true, true]),
  insights:          L("Insights: story volume, themes, unanswered", "reputation", [false, "basic", "advanced", "advanced"]),
  // ---- Response ---------------------------------------------------------------------------
  right_of_reply:    L("Right of reply (publish, edit within 24h, delete your own)", "response", [true, true, true, true]),
  story_inbox:       L("Stories inbox (authors always hidden)", "response", ["basic", true, true, true]),
  response_mgmt:     L("Response management: templates, drafts, assignment, deadlines", "response", ["basic", true, "advanced", "advanced"]),
  internal_notes:    L("Private internal notes", "response", [false, true, true, true]),
  ai_reply:          L("AI response assistant (suggested reply)", "response", [false, true, true, true]),
  response_pro:      L("Tone check, similar earlier stories, suggested actions", "response", [false, false, true, true]),
  response_analytics:L("Response analytics and Company Response Score", "response", [false, true, "advanced", "advanced"]),
  approvals:         L("Approval workflow before a reply goes public", "response", [false, false, true, true]),
  multi_approval:    L("Multi-level approval", "response", [false, false, false, true]),
  case_mgmt:         L("Case management (case numbers, status, resolution)", "response", [false, false, true, true]),
  escalation:        L("Escalation workflows and department/regional routing", "response", [false, false, false, true]),
  disputes:          L("Factual-dispute requests with evidence (never “delete it”)", "response", [true, true, true, true]),
  // ---- Intelligence -----------------------------------------------------------------------
  alerts:            L("Alerts: bursts, topics, severity", "intelligence", [false, "basic", "advanced", "advanced"]),
  alert_routing:     L("Alert routing to roles (HR, Communications…)", "intelligence", [false, false, true, true]),
  benchmarks:        L("Industry benchmarks and percentiles", "intelligence", [false, false, true, true]),
  competitor:        L("You vs industry comparison", "intelligence", [false, false, true, true]),
  competitor_groups: L("Custom competitor groups, size and geography cuts", "intelligence", [false, false, false, true], { status: "soon" }),
  salary_intel:      L("Salary intelligence (aggregated, cohort-protected)", "intelligence", ["basic", true, "advanced", "advanced"]),
  salary_enterprise: L("Multi-location and department compensation, historical, API", "intelligence", [false, false, false, true], { status: "soon" }),
  hiring_analytics:  L("Hiring and interview experience analytics", "intelligence", [false, true, true, true]),
  claim_consistency: L("Job-claim consistency", "intelligence", ["basic", true, "advanced", "advanced"]),
  ai_insights:       L("AI-written insight summaries", "intelligence", [false, false, true, true], { status: "soon" }),
  // ---- Improvement ------------------------------------------------------------------------
  improvement:       L("Improvement initiatives and “You improved” tracking", "improvement", [false, true, true, true]),
  // ---- Employer & talent ------------------------------------------------------------------
  announcements:     L("Official company announcements", "employer", [true, true, true, true]),
  faq:               L("“What we want candidates to know” FAQ", "employer", [true, true, true, true]),
  ask_before_joining:L("Ask Before Joining and candidate questions", "employer", [true, true, true, true]),
  profile_builder:   L("Employer profile builder", "employer", ["basic", true, "advanced", "advanced"]),
  official_facts:    L("Official facts (staff-verified where possible)", "employer", [true, true, true, true]),
  showcase:          L("Employer showcase (clearly labelled company content)", "employer", [false, true, true, true]),
  talent_interest:   L("Talent interest (aggregate count only)", "employer", [false, true, true, true]),
  brand_analytics:   L("Employer brand analytics", "employer", [false, false, true, true]),
  jobs_linked:       L("Jobs linked to your company page", "employer", ["basic", true, true, true]),
  candidate_analytics:L("Candidate analytics and hiring funnel", "employer", [false, false, true, true], { status: "soon" }),
  events:            L("Employer events and AMAs", "employer", [false, true, true, true], { status: "soon" }),
  newsletter:        L("Company newsletter to followers", "employer", [false, false, true, true], { status: "soon" }),
  pulse:             L("Anonymous employee pulse surveys", "employer", [false, false, false, true], { status: "soon" }),
  // ---- Team & security --------------------------------------------------------------------
  reports_basic:     L("On-screen summary report", "team", [false, true, true, true]),
  csv:               L("CSV exports", "team", [false, false, true, true]),
  pdf:               L("PDF reports (monthly, quarterly, custom dates)", "team", [false, false, true, true]),
  scheduled_reports: L("Scheduled and automated report delivery", "team", [false, false, false, true], { status: "soon" }),
  roles:             L("Team roles and permissions", "team", ["basic", "basic", "advanced", "custom"]),
  audit_log:         L("Audit log of team actions", "team", [false, false, true, true]),
  priority_review:   L("Priority company-support and report review", "team", [false, false, true, true]),
  sso:               L("Company SSO (SAML / OIDC / SCIM)", "team", [false, false, false, true], { status: "soon" }),
  api:               L("API access", "team", [false, false, false, true], { status: "soon" }),
  ats:               L("ATS and HRIS integrations", "team", [false, false, false, true], { status: "soon" }),
  security_controls: L("Data retention, IP restrictions, session controls", "team", [false, false, false, true], { status: "soon" }),
};

// Seats (representatives including the owner).
export const SEATS = { none: 1, business: 3, business_pro: 10, enterprise: 50 };
// Alert rules a plan may keep.
export const ALERT_RULES_MAX = { none: 0, business: 5, business_pro: 25, enterprise: 100 };
// Alert kinds each level may create.
export const ALERT_KINDS = {
  basic:    ["negative_burst", "topic_count", "severity"],
  advanced: ["negative_burst", "topic_count", "severity", "trend", "location", "department", "percentile_drop", "claim_inconsistency"],
};
// Roles a plan can assign to representatives. Free and Business: basic set; Pro: all; Enterprise: all (custom later).
export const BASIC_ROLES = ["admin", "communications"];

const idx = (plan) => Math.max(0, PLAN_KEYS.indexOf(plan));

// The raw level for a feature on a plan (false when not included).
export function levelOf(plan, key) { const f = FEATURES[key]; return f ? f.levels[idx(plan)] : false; }
// Is the feature included at all? (A "public" or "basic" level counts as included.)
export function has(plan, key) { return !!levelOf(plan, key); }
// Is it at the advanced level (or fully on)?
export function advanced(plan, key) { const v = levelOf(plan, key); return v === true || v === "advanced" || v === "custom"; }
// Cheapest plan that includes a feature, for "upgrade to…" messages.
export function planFor(key, atLeast = true) {
  const f = FEATURES[key]; if (!f) return null;
  for (let i = 0; i < PLAN_KEYS.length; i++) { const v = f.levels[i]; if (atLeast ? !!v : (v === true || v === "advanced" || v === "custom")) return PLAN_KEYS[i]; }
  return null;
}
export const planLabel = (p) => PLAN_LABELS[p] || p;

// Grouped for the comparison table.
export function comparisonByPillar() {
  return PILLARS.map((p) => ({ ...p, rows: Object.entries(FEATURES).filter(([, f]) => f.pillar === p.key).map(([key, f]) => ({ key, label: f.label, levels: f.levels, status: f.status })) }));
}
