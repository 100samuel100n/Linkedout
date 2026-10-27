// Staff roles & permissions. Shared by the API guard (lib/admin/guard.js),
// the web admin UI and the native admin screens (which get the already-
// filtered `sections` + `permissions` from GET /api/admin/me — they never
// hard-code role logic, so changing a role here changes both apps).
//
// Design rule inherited from the Moderation & Anonymity Architecture doc:
// content/trust staff act on ANONYMOUS IDs and post/report ids. Only roles
// holding `users.pii` ever see an email/real name, and revealing who is
// behind an anonymous_id still goes through the two-person break-glass
// scripts — nothing here adds an HTTP path around that.

export const ROLES = {
  user: [],
  analyst: ["overview.read", "analytics.read", "network.read", "infra.read"],
  support: ["overview.read", "users.read", "users.pii", "support.handle", "verification.review", "appeals.read"],
  moderator: ["overview.read", "content.moderate", "reports.handle", "dm.review", "spam.manage", "users.read", "users.enforce", "appeals.read", "search.manage"],
  trust_safety: ["overview.read", "content.moderate", "reports.handle", "dm.review", "spam.manage", "users.read", "users.enforce", "users.enforce.severe", "appeals.handle", "network.read", "companies.manage", "dmca.handle", "feed.manage", "search.manage", "security.read", "breakglass.read"],
  verification_reviewer: ["overview.read", "verification.review", "verification.docs", "companies.manage", "users.read"],
  ads_manager: ["overview.read", "ads.review"],
  finance: ["overview.read", "payments.read", "payments.manage", "ads.review"],
  legal: ["overview.read", "legal.handle", "dmca.handle", "users.read", "users.pii", "breakglass.read", "audit.read"],
  admin: ["*admin"],
  super_admin: ["*"],
};

const ADMIN_ALL = Object.values(ROLES).flat().filter((p) => !p.startsWith("*"));
ADMIN_ALL.push("broadcast.push", "broadcast.email", "gates.bypass", "users.read", "users.pii", "users.enforce", "users.enforce.severe", "appeals.handle", "audit.read", "security.read", "infra.read", "views.read", "security.manage", "incidents.read", "incidents.respond", "incidents.manage", "ai.diagnose");

// Live, database-backed roles (see lib/admin/rbac.js). Until the first load, the built-ins above apply.
let LIVE = null;
export function setLiveRoles(map) { LIVE = map; }
export function permissionsFor(role) {
  const live = LIVE?.[role];
  const p = live ? live.perms : ROLES[role];
  if (!p) return [];
  if (p.includes("*")) return ["*"];
  if (p.includes("*admin")) return [...new Set([...ADMIN_ALL, ...p.filter((x) => !x.startsWith("*"))])];
  return p;
}
// A role can grant a plan: staff/test roles then get that plan's features everywhere (voice notes, files, AI...).
const TIER_RANK = { basic: 0, plus: 1, pro: 2 };
export function roleTierGrant(role) {
  const g = LIVE?.[role]?.planTier || (role === "admin" || role === "super_admin" ? "pro" : "");
  return g || null;
}
export const bypassesGates = (role) => can(role, "gates.bypass") || roleTierGrant(role) === "pro";
export const isStaffRole = (role) => !!role && role !== "user" && (LIVE ? role in LIVE : role in ROLES);
export function can(role, perm) {
  const p = permissionsFor(role);
  return p.includes("*") || p.includes(perm);
}
export function bestTier(a, b) { return (TIER_RANK[a] ?? -1) >= (TIER_RANK[b] ?? -1) ? a : b; }

// Sections of the dashboard → the permission that unlocks them. `kind`
// tells the generic UI how to render it (the endpoint is /api/admin/<id>).
export const SECTIONS = [
  { id: "overview", label: "Command Center", perm: "overview.read", group: "Overview", kind: "overview" },
  { id: "analytics", label: "Analytics", perm: "analytics.read", group: "Overview", kind: "table" },
  { id: "users", label: "Users & Members", perm: "users.read", group: "People", kind: "users" },
  { id: "enforcements", label: "Account Enforcement", perm: "users.read", group: "People", kind: "table" },
  { id: "verification", label: "Verification", perm: "verification.review", group: "People", kind: "table" },
  { id: "companies", label: "Companies & Orgs", perm: "companies.manage", group: "People", kind: "table" },
  { id: "network", label: "Network Admin", perm: "network.read", group: "People", kind: "table" },
  { id: "moderation", label: "Content Moderation", perm: "content.moderate", group: "Trust & Safety", kind: "table" },
  { id: "reports", label: "Reports Center", perm: "reports.handle", group: "Trust & Safety", kind: "table" },
  { id: "appeals", label: "Appeals", perm: "appeals.read", group: "Trust & Safety", kind: "table" },
  { id: "spam", label: "Spam & Bots", perm: "spam.manage", group: "Trust & Safety", kind: "table" },
  { id: "dmca", label: "Copyright / DMCA", perm: "dmca.handle", group: "Trust & Safety", kind: "table" },
  { id: "legal", label: "Legal & Gov Requests", perm: "legal.handle", group: "Trust & Safety", kind: "table" },
  { id: "breakglass", label: "Break-glass Requests", perm: "breakglass.read", group: "Trust & Safety", kind: "table" },
  { id: "push", label: "Push Notifications", perm: "broadcast.push", group: "Messaging", kind: "broadcast" },
  { id: "emailcast", label: "Email Broadcasts", perm: "broadcast.email", group: "Messaging", kind: "broadcast" },
  { id: "feed", label: "Pinned & Featured", perm: "feed.manage", group: "Feed & Content", kind: "table" },
  { id: "feedcontrols", label: "Feed Controls", perm: "feed.manage", group: "Feed & Content", kind: "table" },
  { id: "announcements", label: "Announcements", perm: "feed.manage", group: "Feed & Content", kind: "table" },
  { id: "search", label: "Search Admin", perm: "search.manage", group: "Feed & Content", kind: "table" },
  { id: "stories", label: "Stories", perm: "content.moderate", group: "Stories & Reality", kind: "table" },
  { id: "storydisputes", label: "Story Reports & Contests", perm: "reports.handle", group: "Stories & Reality", kind: "table" },
  { id: "circlesadmin", label: "Support Circles", perm: "content.moderate", group: "Stories & Reality", kind: "table" },
  { id: "employment", label: "Employment Verification", perm: "verification.review", group: "Stories & Reality", kind: "table" },
  { id: "publicrecords", label: "Public Records (layoffs)", perm: "companies.manage", group: "Stories & Reality", kind: "table" },
  { id: "business", label: "Business Plans", perm: "payments.read", group: "Billing", kind: "table" },
  { id: "leads", label: "Enterprise Leads", perm: "payments.read", group: "Billing", kind: "table" },
  { id: "dm", label: "DM Reports & Safety", perm: "dm.review", group: "Product", kind: "table" },
  { id: "dminvestigations", label: "DM Investigations", perm: "dm.read", group: "Trust & Safety", kind: "dm" },
  { id: "rooms", label: "Vent Rooms", perm: "content.moderate", group: "Product", kind: "table" },
  { id: "jobs", label: "Jobs (paused)", perm: "feed.manage", group: "Product", kind: "table" },
  { id: "payments", label: "Subscribers", perm: "payments.read", group: "Billing", kind: "table" },
  { id: "revenue", label: "Revenue & Plans", perm: "payments.read", group: "Billing", kind: "table" },
  { id: "planlimits", label: "Plan limits & prices", perm: "payments.manage", group: "Billing", kind: "table" },
  { id: "billing", label: "Billing Events", perm: "payments.read", group: "Billing", kind: "table" },
  { id: "promos", label: "Promo Codes", perm: "payments.manage", group: "Billing", kind: "table" },
  { id: "ads", label: "Campaigns & Creatives", perm: "ads.review", group: "Advertising", kind: "table" },
  { id: "adreview", label: "Ad Review Queue", perm: "ads.review", group: "Advertising", kind: "table" },
  { id: "advertisers", label: "Advertisers", perm: "ads.review", group: "Advertising", kind: "table" },
  { id: "adreports", label: "Ad Performance", perm: "ads.review", group: "Advertising", kind: "table" },
  { id: "support", label: "Tickets", perm: "support.handle", group: "Customer Support", kind: "table" },
  { id: "supportmacros", label: "Canned Responses", perm: "support.handle", group: "Customer Support", kind: "table" },
  { id: "soc", label: "Security Operations", perm: "incidents.read", group: "Platform", kind: "soc" },
  { id: "security", label: "Security Center", perm: "security.read", group: "Platform", kind: "table" },
  { id: "infra", label: "Infrastructure", perm: "infra.read", group: "Platform", kind: "table" },
  { id: "aihealth", label: "AI Health Check", perm: "ai.diagnose", group: "Platform", kind: "table" },
  { id: "viewmetrics", label: "Views & Metrics", perm: "views.read", group: "Overview", kind: "table" },
  { id: "staff", label: "Staff Admin", perm: "staff.manage", group: "Platform", kind: "table" },
  { id: "roles", label: "Roles & Permissions", perm: "roles.manage", group: "Platform", kind: "roles" },
  { id: "audit", label: "Audit Logs", perm: "audit.read", group: "Platform", kind: "table" },
];
export const sectionsFor = (role) => SECTIONS.filter((s) => can(role, s.perm));

export const ENFORCEMENT_ACTIONS = {
  warning: { label: "Warning", severe: false },
  label: { label: "Label account", severe: false },
  reduce_visibility: { label: "Reduce visibility", severe: false, restriction: "reduced_visibility" },
  limit_posting: { label: "Limit posting", severe: false, restriction: "limit_posting" },
  limit_replies: { label: "Limit replies", severe: false, restriction: "limit_replies" },
  limit_messaging: { label: "Limit messaging", severe: false, restriction: "limit_messaging" },
  temp_lock: { label: "Temporary lock", severe: true, status: "locked", timed: true },
  temp_suspend: { label: "Temporary suspension", severe: true, status: "suspended", timed: true },
  perm_suspend: { label: "Permanent suspension", severe: true, status: "banned" },
  require_verification: { label: "Require verification", severe: false },
  force_password_reset: { label: "Force password reset", severe: false },
  force_email_verification: { label: "Force email verification", severe: false },
  force_phone_verification: { label: "Force phone verification", severe: false },
  remove_verification: { label: "Remove verification", severe: true },
  remove_privilege: { label: "Remove specific privileges", severe: false, restriction: "custom" },
  restore: { label: "Restore account", severe: false },
};
