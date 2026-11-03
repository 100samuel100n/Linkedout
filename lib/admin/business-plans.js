// Business plan management for admins (WEB ONLY: these sections are hidden from the native admin app).
// The consumer plans (OUT / OUT+ / OUT PRO) already have Subscribers, Revenue, Plan limits, Billing Events and Promo Codes.
// Companies now have the same, in one place:
//   Business Plans       every company on a plan: grant, change, extend, suspend, reactivate, cancel (comped plans), open in Stripe; full detail page
//   Business Limits      every feature level, seats, job slots, alert rules and the displayed prices, per plan, editable live with reset-to-default
//   Business Revenue     MRR / ARR by plan, paying vs comped, renewals due, new and ended this month
//   Business Billing     the plan change history (who, what, when, through Stripe or staff)
// Merged into the section engine by lib/admin/service.js.
import { contentDb } from "@/lib/content/db";
import { can } from "./roles";
import { logStaff } from "./enforce";
import { BUSINESS_PLANS } from "@/lib/tiers";
import { catalog, fmt, setBusinessOverride, clearBusinessOverride, refreshBusinessConfig, PLAN_KEYS, PLAN_LABELS } from "@/lib/business-plan-config";

const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const col = (key, label) => ({ key, label });
const tbl = (columns, rows, extra = {}) => ({ columns, rows, actions: [], summary: [], ...extra });
const ts = (v) => (v ? String(v).slice(0, 16).replace("T", " ") : "");
const day = (v) => (v ? String(v).slice(0, 10) : "");
const cut = (s, k = 80) => (s && s.length > k ? s.slice(0, k) + "…" : s || "");
const DAY = 86400000, iso = (ms = 0) => new Date(Date.now() + ms).toISOString();
const money = (n) => "$" + (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const mrrOf = (r) => (r.status === "active" && r.plan !== "none" ? ((r.billing_interval === "year" ? BUSINESS_PLANS[r.plan]?.annualMonthly : BUSINESS_PLANS[r.plan]?.monthly) || 0) : 0);
const manage = (staff) => { if (!can(staff.role, "payments.manage")) throw bad("Your role can't change business plans.", 403); };
const PLAN_OPTIONS = ["none", "business", "business_pro", "enterprise"];

async function plans() {
  await refreshBusinessConfig();
  return contentDb.prepare("SELECT p.*, c.name FROM company_plans p LEFT JOIN companies c ON c.id = p.company_id ORDER BY (p.status = 'active') DESC, p.updated_at DESC LIMIT 500").all();
}
async function findCompany(q) {
  const t = String(q || "").trim(); if (!t) throw bad("Enter the company name or id.");
  const c = await contentDb.prepare("SELECT id, name FROM companies WHERE id = ? OR lower(name) = lower(?) LIMIT 1").get(t, t);
  if (!c) throw bad("No company with that exact name or id.", 404); return c;
}

export const LIST = {
  async business() {
    const r = await plans(); const t = Date.now();
    const rows = r.map((x) => { const end = x.current_period_end || ""; const soon = x.status === "active" && end && Date.parse(end) - t < 14 * DAY && Date.parse(end) > t;
      return { id: x.company_id, company: x.name || x.company_id.slice(0, 8), plan: PLAN_LABELS[x.plan] || x.plan, billing: x.source === "stripe" ? (x.billing_interval === "year" ? "Yearly" : x.billing_interval === "month" ? "Monthly" : "Stripe") : "Comped", status: x.status, source: x.source === "stripe" ? "Stripe" : x.source === "admin_test" ? "Staff (no payment)" : x.source || "", mrr: mrrOf(x) ? money(mrrOf(x)) : "", renews: day(end) + (soon ? "  ⚠ soon" : ""), updated: ts(x.updated_at) }; });
    const active = r.filter((x) => x.status === "active" && x.plan !== "none"), by = (p) => active.filter((x) => x.plan === p).length;
    const mrr = r.reduce((s, x) => s + mrrOf(x), 0);
    return tbl([col("company", "Company"), col("plan", "Plan"), col("billing", "Billing"), col("status", "Status"), col("source", "Managed by"), col("mrr", "MRR"), col("renews", "Renews / ends"), col("updated", "Last change")], rows, {
      chips: "status", detail: true, create: [{ key: "company", label: "Company (exact name or id)" }, { key: "plan", label: "Plan", options: PLAN_OPTIONS.slice(1) }, { key: "days", label: "Days of access (default 365)", optional: true }], createLabel: "+ Grant a plan (no payment)",
      summary: [["Active business plans", active.length], ["Business / Pro / Enterprise", `${by("business")} / ${by("business_pro")} / ${by("enterprise")}`], ["MRR (estimate)", money(mrr)], ["ARR (estimate)", money(mrr * 12)], ["Paying through Stripe", active.filter((x) => x.source === "stripe").length], ["Comped by staff", active.filter((x) => x.source !== "stripe").length], ["Ending within 14 days", rows.filter((x) => x.renews.includes("soon")).length]],
      actions: [
        { id: "set_plan", label: "Change plan (no payment)", input: { key: "plan", label: "Plan", options: PLAN_OPTIONS } },
        { id: "extend", label: "Extend access", input: { key: "days", label: "Add how many days? (1–730)" }, when: { source: ["Staff (no payment)"] } },
        { id: "suspend", label: "Suspend", danger: true, input: { key: "reason", label: "Reason (recorded in plan history)" }, when: { status: ["active"] } },
        { id: "reactivate", label: "Reactivate", when: { status: ["suspended"] } },
        { id: "cancel", label: "Cancel plan", danger: true, confirm: "Ends this comped plan now; the company drops to the free verified tier.", when: { source: ["Staff (no payment)"], status: ["active", "suspended"] } },
        { id: "open_stripe", label: "Open in Stripe", when: { source: ["Stripe"] } },
      ],
    });
  },

  async bizlimits() {
    await refreshBusinessConfig(true);
    const rows = catalog().map((r) => ({ id: r.id, group: r.group, feature: r.label, plan: PLAN_LABELS[r.plan] || r.plan, value: fmt(r.live), default: fmt(r.def), state: JSON.stringify(r.live) === JSON.stringify(r.def) ? "default" : "changed" }));
    return tbl([col("group", "Area"), col("feature", "Feature"), col("plan", "Plan"), col("value", "Live value"), col("default", "Built-in default"), col("state", "State")], rows, {
      chips: "plan",
      actions: [{ id: "set", label: "Change", input: { key: "value", label: "New value (on / off / basic / advanced / custom / public, or a number)" } }, { id: "reset", label: "Reset to default", when: { state: ["changed"] } }],
      summary: [["Business", money(BUSINESS_PLANS.business.monthly) + "/mo · " + money(BUSINESS_PLANS.business.annual) + "/yr"], ["Business Pro", money(BUSINESS_PLANS.business_pro.monthly) + "/mo · " + money(BUSINESS_PLANS.business_pro.annual) + "/yr"], ["Enterprise", "Custom (sales)"], ["Changed from default", rows.filter((r) => r.state === "changed").length],
        ["Applies to", "server enforcement, the company dashboard, the pre-purchase plan comparison, seat and job limits"], ["Note", "Price rows change what is displayed. Charged amounts come from your Stripe prices."]],
    });
  },

  async bizrevenue() {
    const r = await plans(); const t = Date.now(), m0 = iso(-30 * DAY);
    const active = r.filter((x) => x.status === "active" && x.plan !== "none");
    const rows = ["business", "business_pro", "enterprise"].map((p) => { const a = active.filter((x) => x.plan === p), stripe = a.filter((x) => x.source === "stripe"); const mrr = a.reduce((s, x) => s + mrrOf(x), 0);
      return { id: p, plan: PLAN_LABELS[p], companies: a.length, paying: stripe.length, comped: a.length - stripe.length, yearly: a.filter((x) => x.billing_interval === "year").length, mrr: money(mrr), arr: money(mrr * 12), price: BUSINESS_PLANS[p].monthly ? money(BUSINESS_PLANS[p].monthly) + "/mo" : "Custom" }; });
    const hist = await contentDb.prepare("SELECT plan, status, created_at FROM company_plan_history WHERE created_at > ?").all(m0);
    const started = hist.filter((h) => h.status === "active" && h.plan !== "none").length, ended = hist.filter((h) => h.status !== "active" || h.plan === "none").length;
    const due = active.filter((x) => x.current_period_end && Date.parse(x.current_period_end) > t && Date.parse(x.current_period_end) - t < 30 * DAY).sort((a, b) => a.current_period_end.localeCompare(b.current_period_end));
    const totalMrr = rows.reduce((s, x) => s + Number(x.mrr.replace(/[$,]/g, "")), 0);
    return tbl([col("plan", "Plan"), col("companies", "Active companies"), col("paying", "Paying (Stripe)"), col("comped", "Comped (staff)"), col("yearly", "On yearly billing"), col("price", "List price"), col("mrr", "MRR"), col("arr", "ARR")], rows, {
      summary: [["Total MRR (estimate)", money(totalMrr)], ["Total ARR (estimate)", money(totalMrr * 12)], ["Plan starts, last 30 days", started], ["Plan ends / suspensions, last 30 days", ended], ["Renewals or endings in 30 days", due.length], ["Next due", due.slice(0, 5).map((x) => `${x.name || x.company_id.slice(0, 6)} ${day(x.current_period_end)}`).join(" · ") || "none"],
        ["Note", "Estimates use list prices; discounts, taxes and refunds live in Stripe."]],
    });
  },

  async bizhistory() {
    const rows = (await contentDb.prepare("SELECT h.*, c.name FROM company_plan_history h LEFT JOIN companies c ON c.id = h.company_id ORDER BY h.created_at DESC LIMIT 500").all())
      .map((h) => ({ id: h.id, when: ts(h.created_at), company: h.name || String(h.company_id).slice(0, 8), plan: PLAN_LABELS[h.plan] || h.plan, status: h.status, source: h.source === "stripe" ? "Stripe" : h.source === "admin_test" ? "Staff" : h.source || "", by: String(h.actor || "").replace(/^staff:/, "staff ") }));
    return tbl([col("when", "When"), col("company", "Company"), col("plan", "Plan"), col("status", "Status"), col("source", "Through"), col("by", "By")], rows, { chips: "source", summary: [["Events shown", rows.length], ["Through Stripe", rows.filter((x) => x.source === "Stripe").length], ["By staff", rows.filter((x) => x.source === "Staff").length]] });
  },
};

export const ACT = {
  async business(staff, id, a, b) {
    manage(staff);
    const row = await contentDb.prepare("SELECT * FROM company_plans WHERE company_id = ?").get(id); const biz = await import("@/lib/stories/business");
    const log = async (what, detail) => { await logStaff(staff, `business_plan_${what}`, id, detail || null); await biz.auditCompany?.(id, null, `plan_${what}_by_staff`, detail || what).catch?.(() => {}); };
    if (a === "set_plan") { const plan = String(b.plan || "").trim(); if (!PLAN_OPTIONS.includes(plan)) throw bad("Pick none, business, business_pro or enterprise."); await biz.setCompanyPlanForTesting({ companyId: id, plan, staffId: staff.id }); return log("set", plan); }
    if (!row) throw bad("This company has no plan record yet. Use “Grant a plan” first.", 404);
    const keep = { companyId: id, plan: row.plan, interval: row.billing_interval, periodEnd: row.current_period_end, source: row.source, actor: `staff:${staff.id}` };
    if (a === "extend") { if (row.source === "stripe") throw bad("This plan is billed through Stripe; its dates follow the subscription."); const d = Math.round(+b.days); if (!(d >= 1 && d <= 730)) throw bad("Enter 1 to 730 days."); const base = Math.max(Date.now(), Date.parse(row.current_period_end || 0) || 0); await biz.setCompanyPlan({ ...keep, status: "active", periodEnd: new Date(base + d * DAY).toISOString() }); return log("extend", `+${d} days`); }
    if (a === "suspend") { const why = String(b.reason || "").trim(); if (!why) throw bad("Give a reason."); await biz.setCompanyPlan({ ...keep, status: "suspended" }); return log("suspend", why); }
    if (a === "reactivate") { await biz.setCompanyPlan({ ...keep, status: "active" }); return log("reactivate"); }
    if (a === "cancel") { if (row.source === "stripe") throw bad("This plan is billed through Stripe. Cancel it in Stripe and the plan updates automatically."); await biz.setCompanyPlan({ ...keep, plan: "none", status: "inactive", periodEnd: iso() }); return log("cancel"); }
    if (a === "open_stripe") { if (!row.stripe_customer_id) throw bad("No Stripe customer is linked."); return { url: `https://dashboard.stripe.com/customers/${encodeURIComponent(row.stripe_customer_id)}` }; }
    throw bad("Unknown action.");
  },
  async bizlimits(staff, id, a, b) {
    if (!can(staff.role, "payments.manage")) throw bad("Your role can't change plan limits.", 403);
    if (a === "reset") { await clearBusinessOverride(id); await logStaff(staff, "business_limit_reset", id); return; }
    if (a !== "set") throw bad("Unknown action.");
    const v = await setBusinessOverride(staff, id, b.value); await logStaff(staff, "business_limit_set", id, String(v));
  },
};

export const CREATE = {
  async business(staff, b) {
    manage(staff); const c = await findCompany(b.company); const plan = String(b.plan || "").trim(); if (!PLAN_OPTIONS.slice(1).includes(plan)) throw bad("Pick business, business_pro or enterprise.");
    const days = b.days ? Math.round(+b.days) : 365; if (!(days >= 1 && days <= 1095)) throw bad("Days must be 1 to 1095.");
    const biz = await import("@/lib/stories/business");
    await biz.setCompanyPlan({ companyId: c.id, plan, status: "active", interval: null, periodEnd: iso(days * DAY), source: "admin_test", actor: `staff:${staff.id}` });
    await logStaff(staff, "business_plan_grant", `${c.name}: ${plan}`, `${days} days`);
  },
};

export const DETAIL = {
  async business(staff, id) {
    const p = await contentDb.prepare("SELECT p.*, c.name, c.industry, c.verification, c.status AS company_status FROM company_plans p LEFT JOIN companies c ON c.id = p.company_id WHERE p.company_id = ?").get(id); if (!p) throw bad("No plan record for this company.", 404);
    const { FEATURES, SEATS, JOBS_MAX, ALERT_RULES_MAX, levelOf } = await import("@/lib/business-features"); await refreshBusinessConfig();
    const q = async (fn, d) => { try { return await fn(); } catch { return d; } };      // a missing optional table must never break the page
    const hist = await q(() => contentDb.prepare("SELECT plan, status, source, actor, created_at FROM company_plan_history WHERE company_id = ? ORDER BY created_at DESC LIMIT 20").all(id), []);
    const audit = await q(() => contentDb.prepare("SELECT action, detail, actor, created_at FROM company_audit WHERE company_id = ? AND action LIKE 'plan%' ORDER BY created_at DESC LIMIT 12").all(id), []);
    const reps = +(await q(() => contentDb.prepare("SELECT COUNT(*) n FROM company_reps WHERE company_id = ?").get(id), { n: 0 })).n + 1;
    const jobs = +(await q(() => contentDb.prepare("SELECT COUNT(*) n FROM jobs WHERE company_id = ? AND status = 'open'").get(id), { n: 0 })).n;
    const rules = +(await q(() => contentDb.prepare("SELECT COUNT(*) n FROM company_alert_rules WHERE company_id = ?").get(id), { n: 0 })).n;
    const kv = (o) => Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => [k, String(v)]);
    const plan = p.status === "active" ? p.plan : "none"; const inc = Object.entries(FEATURES).filter(([k]) => levelOf(plan, k)).map(([, f]) => f.label);
    return { title: p.name || id, status: p.status, blocks: [
      { title: "Plan", rows: kv({ Plan: PLAN_LABELS[p.plan] || p.plan, Status: p.status, "Effective now": PLAN_LABELS[plan], Billing: p.billing_interval || (p.source === "stripe" ? "" : "Comped by staff"), "Managed by": p.source === "stripe" ? "Stripe" : "Staff (no payment)", "Renews / ends": ts(p.current_period_end), MRR: mrrOf(p) ? money(mrrOf(p)) : "", "Last change": ts(p.updated_at) }) },
      { title: "Company", rows: kv({ Name: p.name, Industry: p.industry, Verification: p.verification, "Company status": p.company_status, "Stripe customer": p.stripe_customer_id ? String(p.stripe_customer_id).slice(0, 14) + "…" : "", "Stripe subscription": p.stripe_subscription_id ? String(p.stripe_subscription_id).slice(0, 14) + "…" : "" }) },
      { title: "Usage against plan limits", rows: kv({ Seats: `${reps} of ${SEATS[plan]}`, "Job slots": `${jobs} of ${JOBS_MAX[plan]}`, "Alert rules": `${rules} of ${ALERT_RULES_MAX[plan]}` }) },
      { title: `Included features (${inc.length})`, rows: inc.length ? inc.map((x) => ["✓", x]) : [["", "Only the free verified page"]] },
      { title: "Plan history", rows: hist.length ? hist.map((h) => [ts(h.created_at), `${PLAN_LABELS[h.plan] || h.plan} · ${h.status} · ${h.source === "stripe" ? "Stripe" : h.source === "admin_test" ? "staff" : h.source || ""}${h.actor ? " · " + String(h.actor).replace("staff:", "by ") : ""}`]) : [["", "No history"]] },
      ...(audit.length ? [{ title: "Company audit (plan events)", rows: audit.map((x) => [ts(x.created_at), `${x.action}${x.detail ? " · " + cut(x.detail, 90) : ""}`]) }] : []),
    ] };
  },
};
export { PLAN_KEYS };