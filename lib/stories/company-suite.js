// The company's working tools. Every function takes a `ctx` from companyCtx() (lib/stories/business.js), which
// says who the caller is for THIS company, their role, and what the plan includes.
//
// Hard rules, enforced here and not in the UI:
//   * A story is shown to the company exactly as it is shown to the public. The author is never selected from the
//     database for a company-facing view (no anonymous_id, no author_display, no alias).
//   * A company can reply, annotate privately, assign, escalate and dispute facts. It can NEVER hide, edit or delete a story.
//   * Company-authored content (FAQ, announcements, answers, showcase) is kept in its own tables and labelled as the company's.
import crypto from "node:crypto";
import { contentDb, formatRelativeTime } from "../content/db.js";
import { StoryError, addCompanyResponse, fileDispute, normCompany, addClaim } from "./service.js";
import { redactFields } from "./redact.js";
import { THEMES, THEME_BY_KEY, rowThemes } from "./themes.js";
import { STORY_FORMATS } from "./constants.js";
import { auditCompany, repKeyByHandle, repHandle, needFeature } from "./business.js";
import { advanced, has, levelOf, SEATS } from "../business-features.js";
import { ROLE_DEFS, roleLabel } from "../company-roles.js";
import { callModel, isAiConfigured } from "../ai.js";
import { notifyRoles } from "./company-alerts.js";
import { FAQ_TOPICS, loadPrepared, initiativeProgress, signals } from "./company-intel.js";
import * as M from "./company-metrics.js";

const nowIso = () => new Date().toISOString(), uid = () => crypto.randomUUID();
const clip = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const J = (v, f) => { try { return JSON.parse(v); } catch { return f; } };
const EDIT_WINDOW_MS = 24 * 3600e3;
const FORMAT_LABEL = Object.fromEntries(STORY_FORMATS.map((f) => [f.key, f.label]));
const WHO = { current: "Anonymous current employee", former: "Anonymous former employee", applicant: "Anonymous applicant", customer: "Anonymous customer" };
const forbid = (m = "Your role on this company can't do that.") => new StoryError(m, 403, "ROLE_FORBIDDEN");
const need = (ctx, perm) => { if (!ctx.can(perm)) throw forbid(); };
const paid = (ctx, feature, label) => { if (!advanced(ctx.plan, feature)) throw new StoryError(`${label} is part of a paid company plan.`, 403, "PLAN_REQUIRED"); };

// ------------------------------------------------------------------ the shape the UI needs to know who it is talking to
export async function meta(ctx) {
  const reps = Number((await contentDb.prepare("SELECT COUNT(*) n FROM company_reps WHERE company_id = ?").get(ctx.c.id)).n) + 1;
  const st = await settings(ctx.c.id);
  const features = {}; for (const k of ["story_inbox", "response_mgmt", "internal_notes", "ai_reply", "response_pro", "approvals", "multi_approval", "case_mgmt", "escalation", "alerts", "alert_routing", "benchmarks", "salary_intel", "hiring_analytics", "claim_consistency", "improvement", "profile_builder", "showcase", "talent_interest", "brand_analytics", "csv", "pdf", "reports_basic", "audit_log", "reputation_trends", "what_changed", "roles", "insights", "response_analytics"]) features[k] = levelOf(ctx.plan, k);
  return { company: { id: ctx.c.id, name: ctx.c.name, industry: ctx.c.industry, verified: ctx.verified }, role: ctx.role, roleLabel: roleLabel(ctx.role), handle: ctx.handle,
    plan: ctx.plan, planStatus: ctx.planInfo.status, renews: ctx.planInfo.renews, planSource: ctx.planInfo.source, perms: ROLE_DEFS[ctx.role].perms, features, seats: { used: reps, max: SEATS[ctx.plan] || 1 }, settings: st };
}
export async function settings(companyId) {
  const r = await contentDb.prepare("SELECT approval_levels, sla_hours FROM company_settings WHERE company_id = ?").get(companyId);
  return { approvalLevels: r ? Number(r.approval_levels) : 0, slaHours: r ? Number(r.sla_hours) : 72 };
}
export async function saveSettings(ctx, { approvalLevels, slaHours }) {
  need(ctx, "settings.manage");
  const max = ctx.plan === "enterprise" ? 3 : ctx.plan === "business_pro" ? 1 : 0;
  const lv = Math.max(0, Math.min(max, Math.round(Number(approvalLevels) || 0)));
  if (Number(approvalLevels) > 0 && max === 0) throw new StoryError("Approval workflows are part of Business Pro.", 403, "PLAN_REQUIRED");
  const team = Number((await contentDb.prepare("SELECT COUNT(*) n FROM company_reps WHERE company_id = ?").get(ctx.c.id)).n) + 1;
  if (lv > 0 && team < 2) throw new StoryError("Add a second representative first: someone other than the author has to approve.", 400, "BAD_REQUEST");
  const sla = Math.max(4, Math.min(720, Math.round(Number(slaHours) || 72)));
  await contentDb.prepare(`INSERT INTO company_settings (company_id, approval_levels, sla_hours, updated_at) VALUES (?,?,?,?)
    ON CONFLICT (company_id) DO UPDATE SET approval_levels = EXCLUDED.approval_levels, sla_hours = EXCLUDED.sla_hours, updated_at = EXCLUDED.updated_at`).run(ctx.c.id, lv, sla, nowIso());
  await auditCompany(ctx.c.id, ctx.handle, "settings_changed", `approval levels ${lv}, response target ${sla}h`);
  return { ok: true };
}

// ------------------------------------------------------------------ stories inbox
async function ownStory(ctx, storyId) {
  const s = await contentDb.prepare("SELECT id, format, title, body, told, actual, impact, themes, created_at, employment_claim, views FROM stories WHERE id = ? AND status = 'published' AND (company_id = ? OR company_key = ?)").get(storyId, ctx.c.id, normCompany(ctx.c.name));
  if (!s) throw new StoryError("That story isn't about your company.", 404, "NOT_FOUND");
  return s;
}
const excerpt = (s, n = 280) => { const t = (s.title ? s.title + " — " : "") + s.body; return t.length > n ? t.slice(0, n).trimEnd() + "…" : t; };

export async function listInbox(ctx, { filter = "all", q = "" } = {}) {
  need(ctx, "story.view");
  const rows = await contentDb.prepare("SELECT id, format, title, body, told, actual, impact, themes, created_at, employment_claim, views FROM stories WHERE status='published' AND (company_id = ? OR company_key = ?) ORDER BY created_at DESC LIMIT 300").all(ctx.c.id, normCompany(ctx.c.name));
  const ids = rows.map((r) => r.id);
  const [inbox, replies, notes, drafts] = ids.length ? await Promise.all([
    contentDb.prepare("SELECT story_id, status, priority, assigned_to, due_at, review_flag, escalated, case_no, case_status FROM company_inbox WHERE company_id = ? AND story_id = ANY(?)").all(ctx.c.id, ids),
    contentDb.prepare("SELECT story_id, COUNT(*) n, MIN(created_at) first FROM company_responses WHERE company_id = ? AND kind = 'reply' AND story_id = ANY(?) GROUP BY story_id").all(ctx.c.id, ids),
    contentDb.prepare("SELECT story_id, COUNT(*) n FROM company_notes WHERE company_id = ? AND story_id = ANY(?) GROUP BY story_id").all(ctx.c.id, ids),
    contentDb.prepare("SELECT story_id, status FROM company_drafts WHERE company_id = ? AND story_id = ANY(?) AND status IN ('draft','pending','approved')").all(ctx.c.id, ids),
  ]) : [[], [], [], []];
  const I = Object.fromEntries(inbox.map((x) => [x.story_id, x])), R = Object.fromEntries(replies.map((x) => [x.story_id, x])), N = Object.fromEntries(notes.map((x) => [x.story_id, Number(x.n)]));
  const D = {}; for (const d of drafts) (D[d.story_id] ||= []).push(d.status);
  const now = Date.now(), canNotes = has(ctx.plan, "internal_notes");
  let list = rows.map((r) => {
    const i = I[r.id] || {}, rep = R[r.id], due = i.due_at || null;
    return { id: r.id, excerpt: excerpt(r), format: FORMAT_LABEL[r.format] || r.format, who: WHO[r.employment_claim] || "Anonymous", themes: rowThemes(r).map((t) => THEME_BY_KEY[t]?.label).filter(Boolean).slice(0, 5), themeKeys: rowThemes(r),
      at: r.created_at, ago: formatRelativeTime(r.created_at), views: r.views || 0,
      status: rep ? "answered" : i.escalated ? "escalated" : i.status || "new", answered: !!rep, replies: rep ? Number(rep.n) : 0, priority: i.priority || "normal", assignedTo: i.assigned_to || null,
      due, overdue: !rep && !!due && new Date(due).getTime() < now, review: !!i.review_flag, escalated: !!i.escalated, caseNo: i.case_no || null, caseStatus: i.case_status || null,
      notes: canNotes ? N[r.id] || 0 : 0, drafts: D[r.id]?.length || 0 };
  });
  const counts = { all: list.length, unanswered: list.filter((x) => !x.answered).length, answered: list.filter((x) => x.answered).length, overdue: list.filter((x) => x.overdue).length, escalated: list.filter((x) => x.escalated).length, review: list.filter((x) => x.review).length, mine: list.filter((x) => x.assignedTo === ctx.handle).length };
  const f = { unanswered: (x) => !x.answered, answered: (x) => x.answered, overdue: (x) => x.overdue, escalated: (x) => x.escalated, review: (x) => x.review, mine: (x) => x.assignedTo === ctx.handle }[filter];
  if (f) list = list.filter(f);
  const needle = clip(q, 80).toLowerCase(); if (needle) list = list.filter((x) => x.excerpt.toLowerCase().includes(needle));
  return { counts, stories: list.slice(0, 100), canNotes, note: "You see each story exactly as the public does. Who wrote it is never available to a company." };
}

export async function storyDetail(ctx, storyId) {
  need(ctx, "story.view");
  const s = await ownStory(ctx, storyId);
  const [inbox, replies, notes, drafts, templates] = await Promise.all([
    contentDb.prepare("SELECT * FROM company_inbox WHERE company_id = ? AND story_id = ?").get(ctx.c.id, storyId),
    contentDb.prepare("SELECT id, kind, body, created_at, edited_at FROM company_responses WHERE company_id = ? AND story_id = ? ORDER BY created_at").all(ctx.c.id, storyId),
    has(ctx.plan, "internal_notes") ? contentDb.prepare("SELECT id, author_handle, body, created_at FROM company_notes WHERE company_id = ? AND story_id = ? ORDER BY created_at").all(ctx.c.id, storyId) : [],
    advanced(ctx.plan, "response_mgmt") ? contentDb.prepare("SELECT id, author_handle, body, status, approvals, decision_note, created_at, updated_at FROM company_drafts WHERE company_id = ? AND story_id = ? AND status <> 'published' ORDER BY created_at DESC").all(ctx.c.id, storyId) : [],
    advanced(ctx.plan, "response_mgmt") ? contentDb.prepare("SELECT id, title, body FROM company_templates WHERE company_id = ? ORDER BY title").all(ctx.c.id) : [],
  ]);
  const themes = rowThemes(s), st = await settings(ctx.c.id);
  const out = {
    story: { id: s.id, format: FORMAT_LABEL[s.format] || s.format, title: s.title, body: s.body, told: s.told, actual: s.actual, impact: s.impact, who: WHO[s.employment_claim] || "Anonymous", at: s.created_at, ago: formatRelativeTime(s.created_at), themes: themes.map((t) => ({ key: t, label: THEME_BY_KEY[t]?.label })).filter((t) => t.label), views: s.views || 0 },
    inbox: inbox ? { status: inbox.status, priority: inbox.priority, assignedTo: inbox.assigned_to, due: inbox.due_at, review: !!inbox.review_flag, escalated: !!inbox.escalated, caseNo: inbox.case_no, caseStatus: inbox.case_status, resolution: inbox.resolution } : { status: "new", priority: "normal" },
    replies: replies.map((r) => ({ id: r.id, kind: r.kind, body: r.body, at: r.created_at, ago: formatRelativeTime(r.created_at), edited: !!r.edited_at, canEdit: Date.now() - new Date(r.created_at).getTime() < EDIT_WINDOW_MS })),
    notes: notes.map((n) => ({ id: n.id, by: n.author_handle, body: n.body, ago: formatRelativeTime(n.created_at) })),
    drafts: drafts.map((d) => ({ id: d.id, by: d.author_handle, body: d.body, status: d.status, approvals: J(d.approvals, []).length, needed: st.approvalLevels || 1, decisionNote: d.decision_note, ago: formatRelativeTime(d.updated_at) })),
    templates, approvalRequired: st.approvalLevels > 0 && has(ctx.plan, "approvals"), editWindowHours: 24,
  };
  if (has(ctx.plan, "response_pro")) {
    const prior = await contentDb.prepare("SELECT id, format, title, body, themes, created_at FROM stories WHERE status='published' AND (company_id = ? OR company_key = ?) AND id <> ? ORDER BY created_at DESC LIMIT 200").all(ctx.c.id, normCompany(ctx.c.name), storyId);
    const similar = prior.filter((p) => rowThemes(p).some((t) => t !== "positive" && themes.includes(t))).slice(0, 5);
    const ids = similar.map((x) => x.id);
    const rr = ids.length ? await contentDb.prepare("SELECT story_id, body FROM company_responses WHERE company_id = ? AND kind = 'reply' AND story_id = ANY(?) ORDER BY created_at").all(ctx.c.id, ids) : [];
    out.similar = similar.map((x) => ({ id: x.id, excerpt: excerpt(x, 160), ago: formatRelativeTime(x.created_at), ourReply: rr.find((y) => y.story_id === x.id)?.body.slice(0, 220) || null }));
    out.suggestedActions = M.suggestedActions(themes);
  }
  return out;
}

// ---- inbox state (assign, review, escalate, priority, cases) ----
async function touch(ctx, storyId, patch) {
  const t = nowIso();
  await contentDb.prepare("INSERT INTO company_inbox (company_id, story_id, status, updated_by, updated_at, created_at) VALUES (?,?,?,?,?,?) ON CONFLICT (company_id, story_id) DO NOTHING").run(ctx.c.id, storyId, "new", ctx.handle, t, t);
  const cols = Object.keys(patch); if (!cols.length) return;
  await contentDb.prepare(`UPDATE company_inbox SET ${cols.map((k) => `${k} = ?`).join(", ")}, updated_by = ?, updated_at = ? WHERE company_id = ? AND story_id = ?`).run(...cols.map((k) => patch[k]), ctx.handle, t, ctx.c.id, storyId);
}
export async function markReview(ctx, { storyId, on = true }) {
  need(ctx, "note.write"); needFeature(ctx, "internal_notes", "Internal review"); await ownStory(ctx, storyId);
  await touch(ctx, storyId, { review_flag: on ? 1 : 0, status: on ? "in_review" : "new" }); await auditCompany(ctx.c.id, ctx.handle, on ? "story_marked_review" : "story_review_cleared", storyId); return { ok: true };
}
export async function addNote(ctx, { storyId, body }) {
  need(ctx, "note.write"); needFeature(ctx, "internal_notes", "Private notes"); await ownStory(ctx, storyId);
  const text = clip(body, 1500); if (text.length < 2) throw new StoryError("Write a note.");
  await contentDb.prepare("INSERT INTO company_notes (id, company_id, story_id, author_handle, body, created_at) VALUES (?,?,?,?,?,?)").run(uid(), ctx.c.id, storyId, ctx.handle, text, nowIso());
  return { ok: true };
}
export async function assign(ctx, { storyId, handle, dueHours }) {
  need(ctx, "story.assign"); paid(ctx, "response_mgmt", "Assignment and deadlines"); await ownStory(ctx, storyId);
  const st = await settings(ctx.c.id);
  let to = null; if (handle) { const t = await repKeyByHandle(ctx.c.id, handle); if (!t) throw new StoryError("That representative isn't on this team.", 404, "NOT_FOUND"); to = handle; }
  const due = new Date(Date.now() + (Math.max(1, Math.min(720, Math.round(Number(dueHours) || st.slaHours)))) * 3600e3).toISOString();
  await touch(ctx, storyId, { assigned_to: to, due_at: due, status: "in_review" });
  await auditCompany(ctx.c.id, ctx.handle, "story_assigned", `${storyId} → ${to || "nobody"}`); return { ok: true, due };
}
export async function setPriority(ctx, { storyId, priority }) {
  need(ctx, "story.assign"); paid(ctx, "response_mgmt", "Priority"); await ownStory(ctx, storyId);
  if (!["low", "normal", "high", "urgent"].includes(priority)) throw new StoryError("Pick a priority."); await touch(ctx, storyId, { priority }); return { ok: true };
}
export async function escalate(ctx, { storyId, note }) {
  need(ctx, "escalate"); needFeature(ctx, "internal_notes", "Escalation"); await ownStory(ctx, storyId);
  await touch(ctx, storyId, { escalated: 1, status: "escalated", priority: "high" });
  if (clip(note, 1500)) await addNote(ctx, { storyId, body: `Escalated: ${note}` });
  // Enterprise routes escalations to HR and executives as well; every paid plan tells the owner and admins.
  await notifyRoles(ctx.c.id, has(ctx.plan, "escalation") ? ["owner", "admin", "hr", "executive"] : ["owner", "admin"], `A story about ${ctx.c.name} was escalated for attention.`);
  await auditCompany(ctx.c.id, ctx.handle, "story_escalated", storyId); return { ok: true };
}
export async function openCase(ctx, { storyId }) {
  need(ctx, "case.manage"); needFeature(ctx, "case_mgmt", "Case management"); await ownStory(ctx, storyId);
  const cur = await contentDb.prepare("SELECT case_no FROM company_inbox WHERE company_id = ? AND story_id = ?").get(ctx.c.id, storyId);
  if (cur?.case_no) return { caseNo: cur.case_no };
  for (let i = 0; i < 8; i++) {
    const no = `LO-${crypto.randomInt(10000, 100000)}`;
    try { await touch(ctx, storyId, { case_no: no, case_status: "investigating" }); await auditCompany(ctx.c.id, ctx.handle, "case_opened", `${no} · ${storyId}`); return { caseNo: no }; }
    catch (e) { if (!/duplicate|unique/i.test(String(e?.message))) throw e; }
  }
  throw new StoryError("Couldn't create a case number. Try again.", 500, "RETRY");
}
export async function updateCase(ctx, { storyId, status, resolution }) {
  need(ctx, "case.manage"); needFeature(ctx, "case_mgmt", "Case management"); await ownStory(ctx, storyId);
  const patch = {};
  if (status) { if (!["investigating", "awaiting_response", "resolved", "closed"].includes(status)) throw new StoryError("Pick a case status."); patch.case_status = status; if (status === "closed" || status === "resolved") patch.status = "closed"; }
  if (resolution != null) patch.resolution = clip(resolution, 1500);
  await touch(ctx, storyId, patch); await auditCompany(ctx.c.id, ctx.handle, "case_updated", `${storyId} ${status || ""}`.trim()); return { ok: true };
}

// ------------------------------------------------------------------ replies, drafts, templates, approval
async function approvedDraft(ctx, draftId, storyId) {
  const d = await contentDb.prepare("SELECT * FROM company_drafts WHERE id = ? AND company_id = ? AND story_id = ?").get(draftId, ctx.c.id, storyId);
  if (!d || d.status !== "approved") throw new StoryError("This company requires an approved draft before a reply goes public.", 403, "APPROVAL_REQUIRED");
  return d;
}
export async function publishReply(ctx, { storyId, body, draftId }) {
  need(ctx, "reply.publish"); await ownStory(ctx, storyId);
  const st = await settings(ctx.c.id), gated = st.approvalLevels > 0 && has(ctx.plan, "approvals");
  let text = body, draft = null;
  if (gated) { draft = await approvedDraft(ctx, draftId, storyId); text = draft.body; }
  const r = await addCompanyResponse({ companyId: ctx.c.id, ownerKey: ctx.key, storyId, body: text });
  if (draft) await contentDb.prepare("UPDATE company_drafts SET status = 'published', updated_at = ? WHERE id = ?").run(nowIso(), draft.id);
  await touch(ctx, storyId, { status: "closed" }).catch(() => {});
  await auditCompany(ctx.c.id, ctx.handle, "reply_published", storyId); return r;
}
export async function editReply(ctx, { responseId, body }) {
  need(ctx, "reply.edit");
  const r = await contentDb.prepare("SELECT id, created_at FROM company_responses WHERE id = ? AND company_id = ?").get(responseId, ctx.c.id);
  if (!r) throw new StoryError("Reply not found.", 404, "NOT_FOUND");
  if (Date.now() - new Date(r.created_at).getTime() > EDIT_WINDOW_MS) throw new StoryError("Replies can be edited for 24 hours after they're published. After that, publish a follow-up instead.", 403, "EDIT_WINDOW_CLOSED");
  const text = clip(body, 2000); if (text.length < 10) throw new StoryError("Write a response of at least a sentence.");
  await contentDb.prepare("UPDATE company_responses SET body = ?, edited_at = ? WHERE id = ?").run(text, nowIso(), responseId);
  await auditCompany(ctx.c.id, ctx.handle, "reply_edited", responseId); return { ok: true };
}
export async function deleteReply(ctx, { responseId }) {
  need(ctx, "reply.edit");
  const r = await contentDb.prepare("DELETE FROM company_responses WHERE id = ? AND company_id = ?").run(responseId, ctx.c.id);
  if (!r.changes) throw new StoryError("Reply not found.", 404, "NOT_FOUND");
  await auditCompany(ctx.c.id, ctx.handle, "reply_deleted", responseId); return { ok: true };
}
export async function saveDraft(ctx, { id, storyId, body }) {
  need(ctx, "draft.write"); paid(ctx, "response_mgmt", "Drafts"); await ownStory(ctx, storyId);
  const text = clip(body, 2000); if (text.length < 10) throw new StoryError("Write at least a sentence.");
  if (id) {
    const r = await contentDb.prepare("UPDATE company_drafts SET body = ?, status = 'draft', approvals = '[]', decision_note = NULL, updated_at = ? WHERE id = ? AND company_id = ? AND story_id = ? AND status IN ('draft','rejected','pending')").run(text, nowIso(), id, ctx.c.id, storyId);
    if (!r.changes) throw new StoryError("That draft can't be changed.", 400, "BAD_REQUEST"); return { id };
  }
  const nid = uid(), t = nowIso();
  await contentDb.prepare("INSERT INTO company_drafts (id, company_id, story_id, author_key, author_handle, body, status, approvals, created_at, updated_at) VALUES (?,?,?,?,?,?,'draft','[]',?,?)").run(nid, ctx.c.id, storyId, ctx.key, ctx.handle, text, t, t);
  return { id: nid };
}
export async function deleteDraft(ctx, { id }) { need(ctx, "draft.write"); await contentDb.prepare("DELETE FROM company_drafts WHERE id = ? AND company_id = ? AND status <> 'published'").run(id, ctx.c.id); return { ok: true }; }
export async function submitDraft(ctx, { id }) {
  need(ctx, "draft.write"); needFeature(ctx, "approvals", "Approval workflows");
  const r = await contentDb.prepare("UPDATE company_drafts SET status = 'pending', updated_at = ? WHERE id = ? AND company_id = ? AND status IN ('draft','rejected')").run(nowIso(), id, ctx.c.id);
  if (!r.changes) throw new StoryError("That draft can't be submitted.", 400, "BAD_REQUEST");
  await notifyRoles(ctx.c.id, ["owner", "admin", "moderator"], `A reply to a story about ${ctx.c.name} is waiting for approval.`);
  await auditCompany(ctx.c.id, ctx.handle, "draft_submitted", id); return { ok: true };
}
export async function decideDraft(ctx, { id, decision, note }) {
  need(ctx, "draft.approve"); needFeature(ctx, "approvals", "Approval workflows");
  const d = await contentDb.prepare("SELECT * FROM company_drafts WHERE id = ? AND company_id = ?").get(id, ctx.c.id);
  if (!d || d.status !== "pending") throw new StoryError("That draft isn't waiting for approval.", 400, "BAD_REQUEST");
  if (d.author_key === ctx.key) throw new StoryError("You can't approve your own draft. Someone else has to.", 403, "SELF_APPROVAL");
  const st = await settings(ctx.c.id), need_ = Math.max(1, st.approvalLevels || 1), t = nowIso();
  if (decision === "reject") { await contentDb.prepare("UPDATE company_drafts SET status = 'rejected', decision_note = ?, updated_at = ? WHERE id = ?").run(clip(note, 500) || null, t, id); await auditCompany(ctx.c.id, ctx.handle, "draft_rejected", id); return { ok: true, status: "rejected" }; }
  const ap = J(d.approvals, []); if (ap.some((a) => a.handle === ctx.handle)) throw new StoryError("You've already approved this draft.", 400, "BAD_REQUEST");
  ap.push({ handle: ctx.handle, at: t });
  const done = ap.length >= need_;
  await contentDb.prepare("UPDATE company_drafts SET approvals = ?, status = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(ap), done ? "approved" : "pending", t, id);
  await auditCompany(ctx.c.id, ctx.handle, "draft_approved", `${id} (${ap.length}/${need_})`); return { ok: true, status: done ? "approved" : "pending", approvals: ap.length, needed: need_ };
}
export async function saveTemplate(ctx, { id, title, body }) {
  need(ctx, "draft.write"); paid(ctx, "response_mgmt", "Response templates");
  const t = clip(title, 80), b = clip(body, 2000); if (t.length < 2 || b.length < 10) throw new StoryError("Give the template a title and a body.");
  if (id) { await contentDb.prepare("UPDATE company_templates SET title = ?, body = ? WHERE id = ? AND company_id = ?").run(t, b, id, ctx.c.id); return { id }; }
  const n = Number((await contentDb.prepare("SELECT COUNT(*) n FROM company_templates WHERE company_id = ?").get(ctx.c.id)).n);
  if (n >= (ctx.plan === "business" ? 20 : 100)) throw new StoryError("You've reached the template limit for your plan.", 403, "PLAN_LIMIT");
  const nid = uid(); await contentDb.prepare("INSERT INTO company_templates (id, company_id, title, body, created_by, created_at) VALUES (?,?,?,?,?,?)").run(nid, ctx.c.id, t, b, ctx.handle, nowIso()); return { id: nid };
}
export async function deleteTemplate(ctx, { id }) { need(ctx, "draft.write"); await contentDb.prepare("DELETE FROM company_templates WHERE id = ? AND company_id = ?").run(id, ctx.c.id); return { ok: true }; }

// ---- AI response assistant and tone check ----
async function aiBudget(ctx) {
  const n = Number((await contentDb.prepare("SELECT COUNT(*) n FROM company_audit WHERE company_id = ? AND action = 'ai_suggest' AND created_at > ?").get(ctx.c.id, new Date(Date.now() - 3600e3).toISOString())).n);
  if (n >= 20) throw new StoryError("That's a lot of suggestions in an hour. Try again shortly.", 429, "RATE_LIMITED");
}
export async function suggestReply(ctx, { storyId }) {
  need(ctx, "draft.write"); needFeature(ctx, "ai_reply", "The AI response assistant");
  const s = await ownStory(ctx, storyId), themes = rowThemes(s).filter((t) => t !== "positive");
  await aiBudget(ctx); await auditCompany(ctx.c.id, ctx.handle, "ai_suggest", storyId);
  if (isAiConfigured()) {
    try {
      const text = await callModel({ maxTokens: 320,
        system: "You draft a short, calm PUBLIC reply from a company to an anonymous workplace story. Acknowledge the experience first. Never guess who wrote it. Never deny or admit legal liability. Do not promise outcomes you cannot guarantee. No marketing language. Under 130 words. Leave [brackets] where the company must add a real fact, name or contact. Output only the reply text.",
        user: `Company: ${ctx.c.name}\nStory:\n${excerpt(s, 1500)}\nThemes: ${themes.map((t) => THEME_BY_KEY[t]?.label).join(", ") || "none detected"}` });
      return { text: clip(text, 1500), ai: true, note: "Drafted by AI from the public story text. Review it, add real facts where marked, and make it yours before it goes public." };
    } catch { /* fall through to the template */ }
  }
  return { text: M.templateReply({ themes, companyName: ctx.c.name }), ai: false, note: "AI isn't available right now, so this is a starter template. Add real facts where marked." };
}
export async function checkTone(ctx, { body }) { need(ctx, "draft.write"); needFeature(ctx, "response_pro", "Tone checking"); return M.toneCheck(clip(body, 3000)); }

// ------------------------------------------------------------------ disputes (facts, never "delete this")
export async function fileFactDispute(ctx, { storyId, reason, evidence }) {
  need(ctx, "dispute.file"); await ownStory(ctx, storyId);
  const ev = clip(evidence, 2000); if (ev.length < 20) throw new StoryError("Describe what is factually wrong and what you can show. “We'd like it removed” isn't a reason.");
  const dup = await contentDb.prepare("SELECT 1 x FROM story_disputes WHERE story_id = ? AND role = 'company' AND status = 'open'").get(storyId);
  if (dup) throw new StoryError("A factual dispute for this story is already open.", 400, "DUPLICATE");
  await fileDispute({ storyId, reporterKey: ctx.key, role: "company", reason, details: ev });
  await auditCompany(ctx.c.id, ctx.handle, "dispute_filed", storyId); return { ok: true };
}
export async function listDisputes(ctx) {
  need(ctx, "story.view");
  const ids = (await contentDb.prepare("SELECT id FROM stories WHERE (company_id = ? OR company_key = ?) LIMIT 2000").all(ctx.c.id, normCompany(ctx.c.name))).map((r) => r.id);
  if (!ids.length) return [];
  return (await contentDb.prepare("SELECT id, story_id, reason, status, resolution, created_at FROM story_disputes WHERE role = 'company' AND story_id = ANY(?) ORDER BY created_at DESC LIMIT 50").all(ids))
    .map((d) => ({ id: d.id, storyId: d.story_id, reason: d.reason, status: d.status, resolution: d.resolution, ago: formatRelativeTime(d.created_at) }));
}

// ------------------------------------------------------------------ improvement initiatives
export async function listInitiatives(ctx) {
  need(ctx, "story.view"); needFeature(ctx, "improvement", "Improvement tracking");
  const rows = await loadPrepared(ctx.c, 365);
  const list = (await contentDb.prepare("SELECT * FROM company_initiatives WHERE company_id = ? ORDER BY created_at DESC").all(ctx.c.id)).map((i) => initiativeProgress(i, rows));
  return { initiatives: list, themes: THEMES.filter((t) => t.key !== "positive").map((t) => ({ key: t.key, label: t.label, reporters: M.distinct(M.within(rows, Date.now() - 90 * M.DAY).filter((r) => r._t.includes(t.key))) })).sort((a, b) => b.reporters - a.reporters) };
}
export async function saveInitiative(ctx, { id, title, theme, target, status }) {
  need(ctx, "initiatives.manage"); needFeature(ctx, "improvement", "Improvement tracking");
  if (id) {
    const st = ["planned", "in_progress", "done"].includes(status) ? status : null;
    await contentDb.prepare("UPDATE company_initiatives SET title = COALESCE(?, title), target = COALESCE(?, target), status = COALESCE(?, status), updated_at = ?, completed_at = CASE WHEN ? = 'done' THEN ? ELSE completed_at END WHERE id = ? AND company_id = ?")
      .run(clip(title, 120) || null, target != null ? clip(target, 400) : null, st, nowIso(), st, nowIso(), id, ctx.c.id);
    await auditCompany(ctx.c.id, ctx.handle, "initiative_updated", id); return { id };
  }
  const t = clip(title, 120); if (t.length < 4) throw new StoryError("Name the initiative.");
  if (!THEME_BY_KEY[theme] || theme === "positive") throw new StoryError("Pick the issue this is meant to improve.");
  const rows = await loadPrepared(ctx.c, 120), baseline = M.distinct(M.within(rows, Date.now() - 90 * M.DAY).filter((r) => r._t.includes(theme)));
  const nid = uid(), n = nowIso();
  await contentDb.prepare("INSERT INTO company_initiatives (id, company_id, title, theme, target, status, baseline, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(nid, ctx.c.id, t, theme, clip(target, 400) || null, "in_progress", baseline, ctx.handle, n, n);
  await auditCompany(ctx.c.id, ctx.handle, "initiative_created", t); return { id: nid, baseline };
}
export async function deleteInitiative(ctx, { id }) { need(ctx, "initiatives.manage"); await contentDb.prepare("DELETE FROM company_initiatives WHERE id = ? AND company_id = ?").run(id, ctx.c.id); return { ok: true }; }

// ------------------------------------------------------------------ employer side (company-authored, always labelled as the company's)
const requireVerified = (ctx) => { if (!ctx.verified) throw new StoryError("Verify your company page before publishing official content.", 403, "NOT_VERIFIED"); };
export const PROFILE_SECTIONS = [["about", "About"], ["mission", "Mission"], ["culture", "Culture"], ["leadership", "Leadership"], ["benefits", "Benefits"], ["environment", "Working environment"], ["offices", "Offices"], ["teams", "Teams"], ["career", "Career development"], ["programs", "Employee programs"], ["contact", "Contact"]];
const BASIC_SECTIONS = ["about", "mission", "contact"];
export const FACT_KEYS = [["employees", "Number of employees"], ["locations", "Locations"], ["founded", "Founded"], ["website", "Website"], ["remote_policy", "Remote policy"], ["hiring_status", "Hiring status"]];
export const ANNOUNCE_KINDS = ["policy", "benefits", "office", "leadership", "layoffs", "salary", "remote", "culture", "other"];

export async function employerData(ctx) {
  const id = ctx.c.id;
  const [faq, ann, qs, prof, show, interest] = await Promise.all([
    contentDb.prepare("SELECT topic, answer, updated_at FROM company_faq WHERE company_id = ?").all(id),
    contentDb.prepare("SELECT id, title, body, kind, created_at FROM company_announcements WHERE company_id = ? ORDER BY created_at DESC LIMIT 30").all(id),
    contentDb.prepare("SELECT id, question, answer, status, created_at FROM company_questions WHERE company_id = ? AND status <> 'hidden' ORDER BY (status = 'open') DESC, created_at DESC LIMIT 60").all(id),
    contentDb.prepare("SELECT section, body, verified FROM company_profile WHERE company_id = ?").all(id),
    contentDb.prepare("SELECT id, kind, title, url FROM company_showcase WHERE company_id = ? ORDER BY created_at DESC").all(id),
    contentDb.prepare("SELECT COUNT(*) n FROM company_interest WHERE company_id = ?").get(id),
  ]);
  const P = Object.fromEntries(prof.map((p) => [p.section, p]));
  const sections = has(ctx.plan, "profile_builder") && levelOf(ctx.plan, "profile_builder") !== "basic" ? PROFILE_SECTIONS : PROFILE_SECTIONS.filter(([k]) => BASIC_SECTIONS.includes(k));
  const n = Number(interest.n);
  return {
    faq: FAQ_TOPICS.map(([key, label, prompt]) => ({ key, label, prompt, answer: faq.find((f) => f.topic === key)?.answer || "" })),
    announcements: ann.map((a) => ({ id: a.id, title: a.title, body: a.body, kind: a.kind, ago: formatRelativeTime(a.created_at) })), announceKinds: ANNOUNCE_KINDS,
    questions: qs.map((q) => ({ id: q.id, question: q.question, answer: q.answer, status: q.status, ago: formatRelativeTime(q.created_at) })),
    sections: sections.map(([key, label]) => ({ key, label, body: P[key]?.body || "" })), lockedSections: PROFILE_SECTIONS.length - sections.length,
    facts: FACT_KEYS.map(([key, label]) => ({ key, label, body: P[`fact:${key}`]?.body || "", verified: !!P[`fact:${key}`]?.verified })),
    showcase: show, showcaseKinds: ["video", "photo", "tour", "interview", "document", "link"],
    talentInterest: has(ctx.plan, "talent_interest") ? (n >= M.MIN_COHORT ? n : null) : undefined, talentNote: n >= M.MIN_COHORT ? null : `Shown once at least ${M.MIN_COHORT} people have said they're interested. Individuals are never shown.`,
  };
}
export async function saveFaq(ctx, { topic, answer }) {
  need(ctx, "faq.edit"); if (!FAQ_TOPICS.some(([k]) => k === topic)) throw new StoryError("Unknown FAQ topic.");
  const a = clip(answer, 1200);
  if (!a) { await contentDb.prepare("DELETE FROM company_faq WHERE company_id = ? AND topic = ?").run(ctx.c.id, topic); return { ok: true }; }
  if (a.length < 10) throw new StoryError("Give a real answer, at least a sentence.");
  await contentDb.prepare("INSERT INTO company_faq (company_id, topic, answer, updated_by, updated_at) VALUES (?,?,?,?,?) ON CONFLICT (company_id, topic) DO UPDATE SET answer = EXCLUDED.answer, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at").run(ctx.c.id, topic, a, ctx.handle, nowIso());
  await auditCompany(ctx.c.id, ctx.handle, "faq_saved", topic); return { ok: true };
}
export async function publishAnnouncement(ctx, { title, body, kind }) {
  need(ctx, "announce.publish"); requireVerified(ctx);
  const t = clip(title, 140), b = clip(body, 3000); if (t.length < 4 || b.length < 20) throw new StoryError("Add a title and the announcement text.");
  const today = Number((await contentDb.prepare("SELECT COUNT(*) n FROM company_announcements WHERE company_id = ? AND created_at > ?").get(ctx.c.id, new Date(Date.now() - 864e5).toISOString())).n);
  if (today >= 3) throw new StoryError("That's three announcements today. Try again tomorrow.", 429, "RATE_LIMITED");
  const id = uid(); await contentDb.prepare("INSERT INTO company_announcements (id, company_id, title, body, kind, created_by, created_at) VALUES (?,?,?,?,?,?,?)").run(id, ctx.c.id, t, b, ANNOUNCE_KINDS.includes(kind) ? kind : "other", ctx.handle, nowIso());
  await auditCompany(ctx.c.id, ctx.handle, "announcement_published", t); return { id };
}
export async function deleteAnnouncement(ctx, { id }) { need(ctx, "announce.publish"); await contentDb.prepare("DELETE FROM company_announcements WHERE id = ? AND company_id = ?").run(id, ctx.c.id); await auditCompany(ctx.c.id, ctx.handle, "announcement_deleted", id); return { ok: true }; }
export async function answerQuestion(ctx, { id, answer, hide }) {
  need(ctx, "qa.answer"); requireVerified(ctx);
  if (hide) { await contentDb.prepare("UPDATE company_questions SET status = 'hidden' WHERE id = ? AND company_id = ? AND status = 'open'").run(id, ctx.c.id); await auditCompany(ctx.c.id, ctx.handle, "question_hidden", id); return { ok: true }; }
  const a = clip(answer, 1500); if (a.length < 10) throw new StoryError("Give a real answer, at least a sentence.");
  const r = await contentDb.prepare("UPDATE company_questions SET answer = ?, answered_by = ?, answered_at = ?, status = 'answered' WHERE id = ? AND company_id = ? AND status <> 'hidden'").run(a, ctx.handle, nowIso(), id, ctx.c.id);
  if (!r.changes) throw new StoryError("Question not found.", 404, "NOT_FOUND"); await auditCompany(ctx.c.id, ctx.handle, "question_answered", id); return { ok: true };
}
export async function saveProfile(ctx, { section, body }) {
  need(ctx, "profile.edit");
  const isFact = String(section).startsWith("fact:"), key = String(section).replace(/^fact:/, "");
  if (isFact ? !FACT_KEYS.some(([k]) => k === key) : !PROFILE_SECTIONS.some(([k]) => k === section)) throw new StoryError("Unknown profile section.");
  if (!isFact && levelOf(ctx.plan, "profile_builder") === "basic" && !BASIC_SECTIONS.includes(section)) throw new StoryError("More profile sections are part of a paid plan.", 403, "PLAN_REQUIRED");
  const b = clip(body, isFact ? 200 : 2500);
  if (!b) { await contentDb.prepare("DELETE FROM company_profile WHERE company_id = ? AND section = ?").run(ctx.c.id, section); return { ok: true }; }
  // Editing a fact clears its LinkedOut verification: the new value hasn't been checked.
  await contentDb.prepare("INSERT INTO company_profile (company_id, section, body, verified, updated_by, updated_at) VALUES (?,?,?,0,?,?) ON CONFLICT (company_id, section) DO UPDATE SET body = EXCLUDED.body, verified = 0, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at").run(ctx.c.id, section, b, ctx.handle, nowIso());
  await auditCompany(ctx.c.id, ctx.handle, "profile_saved", section); return { ok: true };
}
export async function addShowcase(ctx, { kind, title, url }) {
  need(ctx, "profile.edit"); needFeature(ctx, "showcase", "The employer showcase");
  const u = clip(url, 500); if (!/^https:\/\/[^\s]+$/i.test(u)) throw new StoryError("Use a full https:// link.");
  const t = clip(title, 120); if (t.length < 3) throw new StoryError("Give it a title.");
  const n = Number((await contentDb.prepare("SELECT COUNT(*) n FROM company_showcase WHERE company_id = ?").get(ctx.c.id)).n);
  if (n >= (ctx.plan === "business" ? 12 : 40)) throw new StoryError("You've reached the showcase limit for your plan.", 403, "PLAN_LIMIT");
  const id = uid(); await contentDb.prepare("INSERT INTO company_showcase (id, company_id, kind, title, url, created_at) VALUES (?,?,?,?,?,?)").run(id, ctx.c.id, ["video", "photo", "tour", "interview", "document", "link"].includes(kind) ? kind : "link", t, u, nowIso());
  await auditCompany(ctx.c.id, ctx.handle, "showcase_added", t); return { id };
}
export async function deleteShowcase(ctx, { id }) { need(ctx, "profile.edit"); await contentDb.prepare("DELETE FROM company_showcase WHERE id = ? AND company_id = ?").run(id, ctx.c.id); return { ok: true }; }
export async function publishClaim(ctx, { topic, claim }) {
  need(ctx, "profile.edit"); requireVerified(ctx);
  const r = await addClaim({ companyId: ctx.c.id, topic, claim, submittedBy: ctx.handle, source: "company" });
  await auditCompany(ctx.c.id, ctx.handle, "claim_published", clip(claim, 80)); return r;
}

// ------------------------------------------------------------------ audit, jobs
export async function auditLog(ctx) {
  need(ctx, "audit.view"); needFeature(ctx, "audit_log", "The audit log");
  return (await contentDb.prepare("SELECT actor, action, detail, created_at FROM company_audit WHERE company_id = ? ORDER BY created_at DESC LIMIT 200").all(ctx.c.id))
    .map((a) => ({ who: a.actor?.startsWith("staff:") ? "LinkedOut staff" : a.actor?.replace(/^rep:/, "") || "system", action: a.action.replace(/_/g, " "), detail: a.detail, at: a.created_at, ago: formatRelativeTime(a.created_at) }));
}
export async function jobsFor(ctx) {
  need(ctx, "story.view");
  const rows = await contentDb.prepare("SELECT id, title, company_name, created_at FROM jobs WHERE company_name ILIKE ? ORDER BY created_at DESC LIMIT 100").all(`%${ctx.c.name.replace(/[%_]/g, "")}%`);
  return rows.filter((j) => normCompany(j.company_name) === normCompany(ctx.c.name)).map((j) => ({ id: j.id, title: j.title, ago: formatRelativeTime(j.created_at) }));
}
