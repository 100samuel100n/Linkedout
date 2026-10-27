import { requireViewer, limited, json, fail } from "@/lib/stories/http";
import { companyCtx, listReps, createInvite, removeRep, setRepRole, needFeature } from "@/lib/stories/business";
import * as S from "@/lib/stories/company-suite";
import * as I from "@/lib/stories/company-intel";
import * as A from "@/lib/stories/company-alerts";
import { StoryError } from "@/lib/stories/service";
import { ROLE_DEFS, ASSIGNABLE_ROLES } from "@/lib/company-roles";
import { BASIC_ROLES } from "@/lib/business-features";

// The Company Command Center API. Representatives only. One gate (companyCtx) decides who the caller is for this
// company and what their role and plan allow; every view and action below checks it again for the specific tool.
// Nothing returned here contains an author, a salary submitter or a voter.
const view = (ctx, perm) => { if (!ctx.can(perm)) throw new StoryError("Your role on this company can't see that.", 403, "ROLE_FORBIDDEN"); };

export async function GET(request, { params }) {
  const v = await requireViewer(); if (v.error) return v.error;
  const { id } = await params; const u = new URL(request.url); const q = u.searchParams; const which = q.get("view") || "meta";
  try {
    const ctx = await companyCtx(id, v.key);
    if (which === "meta") return json(await S.meta(ctx));
    if (which === "overview") { view(ctx, "story.view"); A.evaluateRules(id).catch(() => {}); return json(await I.overview(ctx)); }
    if (which === "stories") return json(await S.listInbox(ctx, { filter: q.get("filter") || "all", q: q.get("q") || "" }));
    if (which === "story") return json(await S.storyDetail(ctx, q.get("storyId")));
    if (which === "alerts") { view(ctx, "alerts.view"); needFeature(ctx, "alerts", "Alerts"); A.evaluateRules(id).catch(() => {}); return json(await A.listRules(ctx)); }
    if (which === "insights") { view(ctx, "insights.view"); needFeature(ctx, "insights", "Insights"); return json(await I.insights(ctx)); }
    if (which === "improve") return json(await S.listInitiatives(ctx));
    if (which === "employer") { return json({ ...(await S.employerData(ctx)), brand: ctx.has("brand_analytics") ? await I.brandAnalytics(ctx) : null, claimTopics: Object.keys((await import("@/lib/stories/themes")).CLAIM_TOPICS), signals: await I.publicSignals(ctx.c) }); }
    if (which === "team") {
      view(ctx, "story.view"); const reps = await listReps(id, v.key); const full = ctx.plan === "business_pro" || ctx.plan === "enterprise";
      return json({ reps, seats: ctx.perks.reps, roles: ASSIGNABLE_ROLES.filter((r) => full || BASIC_ROLES.includes(r)).map((r) => ({ key: r, label: ROLE_DEFS[r].label, blurb: ROLE_DEFS[r].blurb })), allRoles: Object.entries(ROLE_DEFS).map(([k, r]) => ({ key: k, label: r.label, blurb: r.blurb })), settings: await S.settings(id), approvalMax: ctx.plan === "enterprise" ? 3 : ctx.plan === "business_pro" ? 1 : 0 });
    }
    if (which === "reports") { view(ctx, "reports.view"); needFeature(ctx, "reports_basic", "Reports"); return json(await I.reportData(ctx, ctx.has("pdf") ? { from: q.get("from"), to: q.get("to") } : {})); }
    if (which === "export") {
      view(ctx, "reports.export"); needFeature(ctx, "csv", "CSV exports");
      const x = await I.exportCsv(ctx, q.get("kind") || "summary", { from: q.get("from"), to: q.get("to") });
      const { auditCompany } = await import("@/lib/stories/business"); await auditCompany(id, ctx.handle, "report_exported", q.get("kind") || "summary");
      return new Response(x.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${x.filename}"` } });
    }
    if (which === "audit") return json({ entries: await S.auditLog(ctx) });
    if (which === "jobs") return json({ jobs: await S.jobsFor(ctx) });
    if (which === "disputes") return json({ disputes: await S.listDisputes(ctx) });
    return json({ error: "Unknown view." }, 400);
  } catch (e) { return fail(e); }
}

const ACTIONS = {
  "story.review": S.markReview, "story.note": S.addNote, "story.assign": S.assign, "story.priority": S.setPriority, "story.escalate": S.escalate,
  "case.open": S.openCase, "case.update": S.updateCase,
  "reply.publish": S.publishReply, "reply.edit": S.editReply, "reply.delete": S.deleteReply,
  "draft.save": S.saveDraft, "draft.delete": S.deleteDraft, "draft.submit": S.submitDraft, "draft.decide": S.decideDraft,
  "template.save": S.saveTemplate, "template.delete": S.deleteTemplate, "ai.suggest": S.suggestReply, "ai.tone": S.checkTone,
  "dispute.file": S.fileFactDispute, "settings.save": S.saveSettings,
  "initiative.save": S.saveInitiative, "initiative.delete": S.deleteInitiative,
  "faq.save": S.saveFaq, "announce.publish": S.publishAnnouncement, "announce.delete": S.deleteAnnouncement, "qa.answer": S.answerQuestion,
  "profile.save": S.saveProfile, "showcase.add": S.addShowcase, "showcase.delete": S.deleteShowcase, "claim.publish": S.publishClaim,
  "alert.save": A.saveRule, "alert.toggle": (ctx, b) => A.toggleRule(ctx, b.id, b.on), "alert.delete": (ctx, b) => A.deleteRule(ctx, b.id), "alert.read": (ctx) => A.markEventsRead(ctx),
};
export async function POST(request, { params }) {
  const v = await requireViewer(); if (v.error) return v.error;
  const { id } = await params; const b = await request.json().catch(() => ({}));
  try {
    if (b.action === "reply.publish") { const blocked = await limited(v.accountId, "company_reply"); if (blocked) return blocked; }
    if (b.action === "rep.invite") return json(await createInvite(id, v.key, b.role));
    if (b.action === "rep.remove") return json(await removeRep(id, v.key, b.handle));
    if (b.action === "rep.role") return json(await setRepRole(id, v.key, b.handle, b.role));
    const fn = ACTIONS[b.action]; if (!fn) return json({ error: "Unknown action." }, 400);
    const ctx = await companyCtx(id, v.key);
    return json(await fn(ctx, b));
  } catch (e) { return fail(e); }
}
