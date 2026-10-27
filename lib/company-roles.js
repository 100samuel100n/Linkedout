// Roles for a company's representatives. A representative is identified only by an alias handle
// (rep-xxxxxx); no role here ever gives access to who wrote a story, who submitted a salary, or how
// anyone voted. Roles shape what a rep can DO with the company's tools, nothing more.

const ALL = [
  "story.view", "reply.publish", "reply.edit", "draft.write", "draft.approve", "story.assign", "note.write", "case.manage", "escalate",
  "alerts.view", "alerts.manage", "insights.view", "benchmark.view", "reports.view", "reports.export",
  "profile.edit", "announce.publish", "faq.edit", "qa.answer", "initiatives.manage", "dispute.file", "jobs.manage",
  "team.manage", "settings.manage", "audit.view", "billing.manage",
];
const without = (...x) => ALL.filter((p) => !x.includes(p));

export const ROLE_DEFS = {
  owner:          { label: "Owner",           blurb: "Full control, including billing and the team.", perms: ALL },
  admin:          { label: "Company admin",   blurb: "Manages the company page, team and tools. No billing.", perms: without("billing.manage") },
  hr:             { label: "HR",              blurb: "Hiring, internal review, assignment and escalation. Cannot reply publicly.", perms: ["story.view", "draft.write", "story.assign", "note.write", "case.manage", "escalate", "alerts.view", "insights.view", "reports.view", "dispute.file", "jobs.manage", "faq.edit", "qa.answer"] },
  communications: { label: "Communications",  blurb: "Public replies, announcements, FAQ and candidate questions.", perms: ["story.view", "reply.publish", "reply.edit", "draft.write", "note.write", "profile.edit", "announce.publish", "faq.edit", "qa.answer", "alerts.view", "insights.view", "reports.view", "dispute.file"] },
  analyst:        { label: "Analyst",         blurb: "Insights, benchmarks, alerts and exports. Cannot reply.", perms: ["story.view", "alerts.view", "alerts.manage", "insights.view", "benchmark.view", "reports.view", "reports.export", "initiatives.manage"] },
  executive:      { label: "Executive",       blurb: "Read-only executive dashboard and reports.", perms: ["story.view", "alerts.view", "insights.view", "benchmark.view", "reports.view"] },
  moderator:      { label: "Response manager", blurb: "Manages company responses: approves, edits, assigns and escalates.", perms: ["story.view", "reply.publish", "reply.edit", "draft.write", "draft.approve", "story.assign", "note.write", "case.manage", "escalate", "alerts.view", "insights.view", "reports.view", "dispute.file"] },
};
// Reps created before roles existed were "responder": they could reply and nothing else.
export const normalizeRole = (r) => (r === "responder" || !ROLE_DEFS[r] ? "communications" : r);
export const roleCan = (role, perm) => ROLE_DEFS[normalizeRole(role)].perms.includes(perm);
export const ASSIGNABLE_ROLES = Object.keys(ROLE_DEFS).filter((r) => r !== "owner");
export const roleLabel = (r) => ROLE_DEFS[normalizeRole(r)].label;
