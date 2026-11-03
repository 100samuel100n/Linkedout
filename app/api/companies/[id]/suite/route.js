import { requireViewer, limited, json, fail } from "@/lib/stories/http";
import { companyCtx, listReps, createInvite, removeRep, setRepRole, needFeature } from "@/lib/stories/business";
import * as S from "@/lib/stories/company-suite";
import * as I from "@/lib/stories/company-intel";
import * as A from "@/lib/stories/company-alerts";
import * as X from "@/lib/stories/company-extras";
import * as H from "@/lib/jobs/company";
import * as JS from "@/lib/jobs/service";
import * as EN from "@/lib/jobs/enterprise";
import * as SSO from "@/lib/security/company-sso";
import { getCurrentAccountId } from "@/lib/session";
import { cookies } from "next/headers";
import { clientIp } from "@/lib/client-ip";
import { contentDb } from "@/lib/content/db";
import { StoryError } from "@/lib/stories/service";
import { ROLE_DEFS, ASSIGNABLE_ROLES } from "@/lib/company-roles";
import { BASIC_ROLES } from "@/lib/business-features";

// The Company Command Center API. Representatives only. One gate (companyCtx) decides who the caller is for this
// company and what their role and plan allow; every view and action below checks it again for the specific tool.
// Nothing returned here contains an author, a salary submitter or a voter.
// Enterprise IP allowlist: when set, the dashboard only answers from those addresses.
const ipGate = async (id, request) => { if (!(await X.ipAllowed(id, clientIp(request)))) throw new StoryError("This company only allows its dashboard from approved networks.", 403, "IP_BLOCKED"); };
// Enterprise SSO: when on, the dashboard only answers to a browser that has completed the company's own sign-in (signed cookie, bound to the account).
const ssoGate = async (id, accountId) => {
  if (!(await SSO.ssoRequired(id))) return;
  const jar = await cookies();
  if (!SSO.checkSsoSession(jar.get(SSO.ssoCookieName(id))?.value, id, accountId)) throw new StoryError("This company requires its single sign-on.", 401, "SSO_REQUIRED");
};
const view = (ctx, perm) => { if (!ctx.can(perm)) throw new StoryError("Your role on this company can't see that.", 403, "ROLE_FORBIDDEN"); };
const need = view;

export async function GET(request, { params }) {
  const v = await requireViewer(); if (v.error) return v.error;
  const { id } = await params; const u = new URL(request.url); const q = u.searchParams; const which = q.get("view") || "meta";
  try {
    const ctx = await companyCtx(id, v.key); await ipGate(id, request); if (which !== "meta") await ssoGate(id, v.accountId);
    if (which === "ics") return new Response(await EN.icsForInterview(q.get("interviewId"), { companyId: id }), { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'attachment; filename="interview.ics"' } });
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
    if (which === "connect") { need(ctx, "settings.manage"); return json({ keys: ctx.has("api") ? await X.listApiKeys(ctx) : null, hooks: ctx.has("webhooks") ? await X.listWebhooks(ctx) : null, ipAllowlist: ctx.has("ip_allowlist") ? await X.getIpAllowlist(ctx) : null, yourIp: clientIp(request), canSchedule: ctx.has("scheduled_reports"), canPeers: ctx.has("competitor_groups"), sso: ctx.has("sso") ? await SSO.publicSso(id) : undefined, retention: ctx.has("security_controls") ? (await contentDb.prepare("SELECT audit_retention_days d FROM company_settings WHERE company_id = ?").get(id))?.d ?? null : undefined, origin: new URL(request.url).origin, schedule: ctx.has("scheduled_reports") ? await X.getSchedule(ctx) : null, peerGroup: ctx.has("competitor_groups") ? await X.getPeerGroup(ctx) : null, industries: ctx.has("competitor_groups") ? await X.industriesAvailable() : [] }); }
    if (which === "jobs") return json(await H.jobsOverview(ctx));
    if (which === "job") return json(await H.jobForEdit(ctx, q.get("jobId")));
    if (which === "applicants") return json(await H.applicants(ctx, q.get("jobId"), q.get("stage") || null));
    if (which === "applicant") return json(await H.applicantDetail(ctx, q.get("applicationId")));
    if (which === "thread") return json({ messages: await H.threadForCompany(ctx, q.get("applicationId"), q.get("since")) });
    if (which === "hiring") return json(await H.hiringHistory(ctx));
    if (which === "ai") return json(await X.aiSummary(ctx));
    if (which === "events") return json({ events: await X.listEvents(ctx), kinds: X.EVENT_KINDS });
    if (which === "newsletter") return json(await X.listNewsletters(ctx));
    if (which === "pulse") return json(await X.listPulses(ctx));
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
  "job.review": (ctx, b) => H.reviewJob(ctx, b.jobId), "app.stage": H.moveStage, "app.rate": H.rateApplicant, "app.note": H.noteApplicant, "app.message": H.messageApplicant, "msgtpl.save": H.saveMsgTemplate, "msgtpl.delete": H.deleteMsgTemplate, "interview.propose": H.proposeInterview, "interview.update": (ctx, b) => H.updateInterview(ctx, { interviewId: b.interviewId, action: b.act }),
  "apikey.create": X.createApiKey, "apikey.revoke": X.revokeApiKey, "webhook.add": X.addWebhook, "webhook.delete": X.deleteWebhook, "webhook.test": X.testWebhook,
  "schedule.save": X.saveSchedule, "peers.save": X.savePeerGroup, "event.save": X.saveEvent, "event.delete": X.deleteEvent, "newsletter.send": X.sendNewsletter, "pulse.create": X.createPulse, "pulse.close": X.closePulse,
  "alert.save": A.saveRule, "alert.toggle": (ctx, b) => A.toggleRule(ctx, b.id, b.on), "alert.delete": (ctx, b) => A.deleteRule(ctx, b.id), "alert.read": (ctx) => A.markEventsRead(ctx),
};
export async function POST(request, { params }) {
  const v = await requireViewer(); if (v.error) return v.error;
  const { id } = await params; const b = await request.json().catch(() => ({}));
  try {
    if (b.action === "reply.publish") { const blocked = await limited(v.accountId, "company_reply"); if (blocked) return blocked; }
    if (b.action === "job.create") return json(await JS.createJob(v, { ...b, forWhom: "my_company", companyId: id }), 201);
    if (b.action === "job.update") return json(await JS.updateJob(v, b.jobId, b));
    if (b.action === "job.status") return json(await JS.setJobStatus(v, b.jobId, b.status));
    if (b.action === "job.claim") return json(await JS.claimJob(v, b.jobId));
    if (b.action === "rep.invite") return json(await createInvite(id, v.key, b.role));
    if (b.action === "rep.remove") return json(await removeRep(id, v.key, b.handle));
    if (b.action === "rep.role") return json(await setRepRole(id, v.key, b.handle, b.role));
    const fn = ACTIONS[b.action]; if (!fn) return json({ error: "Unknown action." }, 400);
    const ctx = await companyCtx(id, v.key); await ipGate(id, request); await ssoGate(id, v.accountId);
    if (b.action === "job.team") return json(await EN.setTeam(ctx, b));
    if (b.action === "job.bulk") return json(await EN.bulkStatus(v, ctx, b));
    if (b.action === "job.import") return json(await EN.importCsv(v, ctx, b));
    if (b.action === "job.promote") return json(await EN.promote(ctx, b));
    if (b.action === "retention.save") return json(await EN.saveRetention(ctx, b));
    if (b.action === "sso.save") { need(ctx, "settings.manage"); if (!ctx.has("sso")) throw new StoryError("Single sign-on is part of Enterprise.", 403, "PLAN_REQUIRED"); await SSO.saveSso(id, b); return json({ ok: true }); }
    if (b.action === "scim.rotate") { need(ctx, "settings.manage"); if (!ctx.has("sso")) throw new StoryError("SCIM is part of Enterprise.", 403, "PLAN_REQUIRED"); return json({ token: await SSO.rotateScimToken(id), note: "Copy it now. It is never shown again." }); }
    if (b.action === "ip.save") return json(await X.saveIpAllowlist(ctx, b, clientIp(request)));
    return json(await fn(ctx, b));
  } catch (e) { return fail(e); }
}
