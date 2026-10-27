// The permission catalog. Two parts:
//  1. BASE: the permissions the code already checks today (these gate real sections/actions).
//  2. GENERATED: resource x action permissions (hundreds). Staff can grant any of them to a role;
//     code paths opt in by calling can(role, "<resource>.<action>"). Custom permissions added in
//     the admin UI are stored in the database and merged in by lib/admin/rbac.js.
export const BASE_PERMISSIONS = {
  "overview.read": "View the Command Center", "analytics.read": "View analytics", "network.read": "View network admin", "infra.read": "View infrastructure",
  "users.read": "View users", "users.pii": "See emails / real names", "users.enforce": "Apply account enforcement", "users.enforce.severe": "Apply severe enforcement (bans, remove verification)",
  "support.handle": "Handle support tickets", "verification.review": "Review verification requests", "verification.docs": "Open verification documents", "appeals.read": "View appeals", "appeals.handle": "Decide appeals",
  "content.moderate": "Moderate content", "reports.handle": "Handle reports", "dm.review": "Review DM reports", "dm.read": "Investigate DMs (case-referenced)", "spam.manage": "Manage spam and bots", "search.manage": "Manage search",
  "companies.manage": "Manage companies", "dmca.handle": "Handle DMCA notices", "feed.manage": "Manage feed, pins and announcements", "security.read": "View the Security Center", "breakglass.read": "View break-glass requests",
  "ads.review": "Review ads and advertisers", "payments.read": "View payments and revenue", "payments.manage": "Manage plans, refunds, promos", "legal.handle": "Handle legal requests", "audit.read": "View audit logs",
  "broadcast.push": "Send push broadcasts", "broadcast.email": "Send email broadcasts", "gates.bypass": "Bypass plan gates (acts as OUT PRO)", "staff.manage": "Manage staff accounts", "roles.manage": "Manage roles and permissions",
  "views.read": "View view counts and metrics", "security.manage": "Manage security policies", "incidents.read": "View incidents", "incidents.respond": "Run incident response actions", "incidents.manage": "Create and close incidents",
  "ai.diagnose": "Run AI diagnostics",
};
export const RESOURCES = {
  Accounts: ["account", "session", "profile", "alias", "avatar", "verification", "mfa", "device", "api_key", "invite"],
  Content: ["post", "comment", "story", "story_update", "story_evidence", "poll", "event", "media", "gif", "hashtag", "circle", "vent_room", "award", "announcement"],
  Messaging: ["dm", "dm_request", "voice_note", "file_share", "sticker", "dm_report", "block"],
  Commerce: ["subscription", "invoice", "refund", "promo", "plan", "ad", "advertiser", "campaign", "business_plan", "lead"],
  Platform: ["company", "job", "layoff_record", "search_term", "notification", "push", "email_broadcast", "feed", "export", "setting"],
  Security: ["alert", "incident", "playbook", "ip_rule", "geo_rule", "rate_limit", "waf_rule", "honeytoken", "secret", "audit_log", "policy", "quarantine"],
};
export const ACTIONS = ["read", "create", "update", "delete", "export", "approve", "restrict", "restore"];
export function generatedPermissions() {
  const out = {};
  for (const [group, list] of Object.entries(RESOURCES)) for (const r of list) for (const a of ACTIONS) out[`${r}.${a}`] = { label: `${a[0].toUpperCase()}${a.slice(1)} · ${r.replace(/_/g, " ")}`, group };
  return out;
}
export function groupOfBase(key) { return key.split(".")[0].replace(/^./, (c) => c.toUpperCase()); }
