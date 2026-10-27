// Company alerts: configurable rules, evaluated when a story is published and whenever the dashboard loads.
// Alerts describe COUNTS and THEMES ("5 reports mention workload in 30 days"), never a person. Rules that cut by
// department or location are clamped to a minimum of 5 reporters so an alert can't point at one individual.
import crypto from "node:crypto";
import { contentDb } from "../content/db.js";
import { createNotification, resolveAliasAccountId } from "../identity/service.js";
import { StoryError } from "./service.js";
import { THEMES, THEME_BY_KEY } from "./themes.js";
import { has, levelOf, ALERT_KINDS, ALERT_RULES_MAX } from "../business-features.js";
import { ROLE_DEFS, normalizeRole } from "../company-roles.js";
import * as M from "./company-metrics.js";
import { loadPrepared, benchmarkFor, signals } from "./company-intel.js";

const DAY = M.DAY, nowIso = () => new Date().toISOString(), J = (v, f) => { try { return JSON.parse(v); } catch { return f; } };
const clampN = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const SEVERE_THEMES = ["harassment", "discrimination", "unpaid_wages", "intimidation"];
const NEG_KEYS = THEMES.filter((t) => t.key !== "positive").map((t) => t.key);
const clipText = (v, n) => String(v || "").trim().slice(0, n);

export const RULE_KINDS = {
  negative_burst:     { label: "Negative stories burst", blurb: "Alert me when N negative stories appear within D days." },
  topic_count:        { label: "Topic count", blurb: "Alert me when a topic (e.g. management) appears in N stories within D days." },
  severity:           { label: "Severe concerns", blurb: "Alert me straight away when a story raises harassment, discrimination, unpaid wages or intimidation." },
  trend:              { label: "Trend", blurb: "Alert me when reports on a topic rise by X% compared with the 30 days before." },
  location:           { label: "Location surge", blurb: "Alert me when stories mentioning a location increase (needs 5+ reporters)." },
  department:         { label: "Department", blurb: "Alert me when stories mention a department (needs 5+ reporters)." },
  percentile_drop:    { label: "Below industry median", blurb: "Alert me when reputation health falls below your industry median." },
  claim_inconsistency:{ label: "Job-claim inconsistency", blurb: "Alert me when reports differ from something you advertise." },
};

export function cleanParams(kind, p = {}) {
  const theme = THEME_BY_KEY[p.theme] && p.theme !== "positive" ? p.theme : "burnout";
  switch (kind) {
    case "negative_burst": return { count: clampN(p.count, 2, 50, 3), days: clampN(p.days, 1, 30, 7) };
    case "topic_count": return { theme, count: clampN(p.count, 2, 100, 5), days: clampN(p.days, 1, 90, 30) };
    case "severity": return { themes: (Array.isArray(p.themes) ? p.themes : SEVERE_THEMES).filter((t) => SEVERE_THEMES.includes(t)).slice(0, 4) };
    case "trend": return { theme, pct: clampN(p.pct, 10, 300, 30), days: 30, min: M.MIN_COHORT };
    case "location": { const t = clipText(p.text, 60); if (t.length < 2) throw new StoryError("Add a location, e.g. Nairobi."); return { text: t, count: clampN(p.count, M.MIN_COHORT, 100, M.MIN_COHORT), days: clampN(p.days, 7, 90, 30) }; }
    case "department": { const t = clipText(p.text, 60); if (t.length < 2) throw new StoryError("Add a department, e.g. Engineering."); return { text: t, count: clampN(p.count, M.MIN_COHORT, 100, M.MIN_COHORT), days: clampN(p.days, 7, 90, 30) }; }
    case "percentile_drop": return { below: clampN(p.below, 10, 90, 50) };
    case "claim_inconsistency": return {};
    default: throw new StoryError("Unknown alert type.");
  }
}
export function describeRule(kind, p) {
  const t = (k) => THEME_BY_KEY[k]?.label || k;
  return { negative_burst: `${p.count}+ negative stories within ${p.days} days`, topic_count: `${t(p.theme)} in ${p.count}+ stories within ${p.days} days`, severity: `Severe concern: ${(p.themes || []).map(t).join(", ")}`,
    trend: `${t(p.theme)} reports up ${p.pct}%+ vs the previous 30 days`, location: `“${p.text}” in ${p.count}+ stories within ${p.days} days`, department: `“${p.text}” in ${p.count}+ stories within ${p.days} days`,
    percentile_drop: `Reputation health below the ${p.below}th percentile of your industry`, claim_inconsistency: "Reports differ from a claim you advertise" }[kind] || kind;
}

// ---- who gets told ---------------------------------------------------------------------------------------------
// Owner, plus reps whose role is in `roles`. Only alias keys are resolved to accounts, inside the identity service.
export async function notifyRoles(companyId, roles, message) {
  const want = new Set(roles?.length ? roles : ["owner", "admin"]);
  const c = await contentDb.prepare("SELECT owner_key FROM companies WHERE id = ?").get(companyId);
  const keys = new Set(); if (c?.owner_key) keys.add(c.owner_key);   // the owner always hears
  for (const r of await contentDb.prepare("SELECT anon_key, role FROM company_reps WHERE company_id = ?").all(companyId)) if (want.has(normalizeRole(r.role))) keys.add(r.anon_key);
  for (const k of keys) { const acct = await resolveAliasAccountId(k).catch(() => null); if (acct) await createNotification(acct, "company_alert", message, null).catch(() => {}); }
}

// ---- rules CRUD ------------------------------------------------------------------------------------------------
export async function listRules(ctx) {
  const rules = (await contentDb.prepare("SELECT id, kind, params, notify_roles, enabled, last_fired_at, created_at FROM company_alert_rules WHERE company_id = ? ORDER BY created_at").all(ctx.c.id))
    .map((r) => { const p = J(r.params, {}); return { id: r.id, kind: r.kind, label: RULE_KINDS[r.kind]?.label || r.kind, params: p, text: describeRule(r.kind, p), notifyRoles: J(r.notify_roles, ["owner", "admin"]), enabled: !!r.enabled, lastFired: r.last_fired_at }; });
  const events = (await contentDb.prepare("SELECT id, kind, severity, message, story_id, created_at, read_at FROM company_alert_events WHERE company_id = ? ORDER BY created_at DESC LIMIT 60").all(ctx.c.id))
    .map((e) => ({ id: e.id, kind: e.kind, severity: e.severity, message: e.message, storyId: e.story_id, at: e.created_at, unread: !e.read_at }));
  const level = levelOf(ctx.plan, "alerts");
  return { rules, events, limit: ALERT_RULES_MAX[ctx.plan] || 0, kinds: (ALERT_KINDS[level === "basic" ? "basic" : "advanced"] || []).map((k) => ({ kind: k, ...RULE_KINDS[k] })), routing: has(ctx.plan, "alert_routing"),
    roles: Object.entries(ROLE_DEFS).map(([k, v]) => ({ key: k, label: v.label })), themes: THEMES.filter((t) => t.key !== "positive").map((t) => ({ key: t.key, label: t.label })) };
}
export async function saveRule(ctx, { id, kind, params, notifyRoles: nr, enabled = true }) {
  if (!ctx.can("alerts.manage") && !ctx.can("escalate")) throw new StoryError("Your role can't manage alerts.", 403, "ROLE_FORBIDDEN");
  if (!has(ctx.plan, "alerts")) throw new StoryError("Alerts are part of a Business plan.", 403, "PLAN_REQUIRED");
  const level = levelOf(ctx.plan, "alerts");
  if (!(ALERT_KINDS[level === "basic" ? "basic" : "advanced"] || []).includes(kind)) throw new StoryError("That alert type is part of Business Pro.", 403, "PLAN_REQUIRED");
  const p = cleanParams(kind, params);
  const roles = has(ctx.plan, "alert_routing") ? (Array.isArray(nr) ? nr.filter((r) => ROLE_DEFS[r]).slice(0, 8) : ["owner", "admin"]) : ["owner", "admin"];
  if (id) {
    const r = await contentDb.prepare("UPDATE company_alert_rules SET params = ?, notify_roles = ?, enabled = ? WHERE id = ? AND company_id = ?").run(JSON.stringify(p), JSON.stringify(roles), enabled ? 1 : 0, id, ctx.c.id);
    if (!r.changes) throw new StoryError("Alert not found.", 404, "NOT_FOUND");
    return { id };
  }
  const n = Number((await contentDb.prepare("SELECT COUNT(*) n FROM company_alert_rules WHERE company_id = ?").get(ctx.c.id)).n);
  if (n >= (ALERT_RULES_MAX[ctx.plan] || 0)) throw new StoryError(`Your plan keeps ${ALERT_RULES_MAX[ctx.plan]} alert rules. Delete one or upgrade.`, 403, "PLAN_LIMIT");
  const nid = crypto.randomUUID();
  await contentDb.prepare("INSERT INTO company_alert_rules (id, company_id, kind, params, notify_roles, enabled, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)").run(nid, ctx.c.id, kind, JSON.stringify(p), JSON.stringify(roles), enabled ? 1 : 0, ctx.handle, nowIso());
  return { id: nid };
}
export async function deleteRule(ctx, id) {
  if (!ctx.can("alerts.manage")) throw new StoryError("Your role can't manage alerts.", 403, "ROLE_FORBIDDEN");
  await contentDb.prepare("DELETE FROM company_alert_rules WHERE id = ? AND company_id = ?").run(id, ctx.c.id); return { ok: true };
}
export async function toggleRule(ctx, id, on) {
  if (!ctx.can("alerts.manage")) throw new StoryError("Your role can't manage alerts.", 403, "ROLE_FORBIDDEN");
  await contentDb.prepare("UPDATE company_alert_rules SET enabled = ? WHERE id = ? AND company_id = ?").run(on ? 1 : 0, id, ctx.c.id); return { ok: true };
}
export async function markEventsRead(ctx) { await contentDb.prepare("UPDATE company_alert_events SET read_at = ? WHERE company_id = ? AND read_at IS NULL").run(nowIso(), ctx.c.id); return { ok: true }; }

// ---- engine ----------------------------------------------------------------------------------------------------
async function fire(rule, companyId, { message, severity = "info", storyId = null }) {
  await contentDb.prepare("INSERT INTO company_alert_events (id, company_id, rule_id, kind, severity, message, story_id, created_at) VALUES (?,?,?,?,?,?,?,?)").run(crypto.randomUUID(), companyId, rule.id, rule.kind, severity, message, storyId, nowIso());
  await contentDb.prepare("UPDATE company_alert_rules SET last_fired_at = ? WHERE id = ?").run(nowIso(), rule.id);
  await notifyRoles(companyId, J(rule.notify_roles, ["owner", "admin"]), message);
}
const COOLDOWN = { severity: 0, percentile_drop: 7 * DAY, claim_inconsistency: 7 * DAY };

// Runs every enabled rule for a company. `storyId` is set when called from a fresh publish (severity rules only look at it).
// Safe to call often: each rule has a cooldown so a busy topic can't flood anyone.
export async function evaluateRules(companyId, { storyId = null } = {}) {
  const c = await contentDb.prepare("SELECT id, name, industry, owner_key FROM companies WHERE id = ? AND status = 'active'").get(companyId);
  if (!c) return { fired: 0 };
  const plan = await contentDb.prepare("SELECT plan, status FROM company_plans WHERE company_id = ?").get(companyId);
  if (!plan || plan.status !== "active" || !has(plan.plan, "alerts")) return { fired: 0 };
  const rules = await contentDb.prepare("SELECT * FROM company_alert_rules WHERE company_id = ? AND enabled = 1").all(companyId);
  if (!rules.length) return { fired: 0 };
  const rows = await loadPrepared(c, 200), now = Date.now(); let fired = 0, bench = null, sig = null;
  const recent = (days) => M.within(rows, now - days * DAY, now);
  for (const r of rules) {
    const p = J(r.params, {}), cool = COOLDOWN[r.kind] ?? DAY;
    if (cool && r.last_fired_at && now - new Date(r.last_fired_at).getTime() < cool) continue;
    try {
      if (r.kind === "severity") {
        if (!storyId) continue;
        const s = rows.find((x) => x.id === storyId); const hit = s && (p.themes || SEVERE_THEMES).find((t) => s._t.includes(t));
        if (hit) { await fire(r, companyId, { severity: "high", storyId, message: `A new story raises a severe workplace concern (${THEME_BY_KEY[hit]?.label}). Review it in your Stories inbox.` }); fired++; }
      } else if (r.kind === "negative_burst") {
        const n = M.distinct(recent(p.days).filter(M.isNegative));
        if (n >= p.count) { await fire(r, companyId, { severity: "medium", message: `${n} negative stories were shared in the last ${p.days} days (your alert is set at ${p.count}).` }); fired++; }
      } else if (r.kind === "topic_count") {
        const n = M.distinct(recent(p.days).filter((x) => x._t.includes(p.theme)));
        if (n >= p.count) { await fire(r, companyId, { severity: "medium", message: `${THEME_BY_KEY[p.theme]?.label} appears in ${n} stories in the last ${p.days} days.` }); fired++; }
      } else if (r.kind === "trend") {
        const cur = M.distinct(recent(30).filter((x) => x._t.includes(p.theme))), prev = M.distinct(M.within(rows, now - 60 * DAY, now - 30 * DAY).filter((x) => x._t.includes(p.theme)));
        if (cur >= p.min && prev >= 3 && ((cur - prev) / prev) * 100 >= p.pct) { await fire(r, companyId, { severity: "medium", message: `Reports about ${THEME_BY_KEY[p.theme]?.label} increased ${Math.round(((cur - prev) / prev) * 100)}% compared with the previous 30 days (${prev} → ${cur}).` }); fired++; }
      } else if (r.kind === "location" || r.kind === "department") {
        const field = r.kind === "location" ? "location" : "department", needle = String(p.text).toLowerCase();
        const cur = M.distinct(recent(p.days).filter((x) => String(x[field] || "").toLowerCase().includes(needle)));
        const prev = M.distinct(M.within(rows, now - 2 * p.days * DAY, now - p.days * DAY).filter((x) => String(x[field] || "").toLowerCase().includes(needle)));
        if (cur >= Math.max(M.MIN_COHORT, p.count) && cur > prev) { await fire(r, companyId, { severity: "info", message: `Stories mentioning ${p.text} increased (${prev} → ${cur} in ${p.days} days).` }); fired++; }
      } else if (r.kind === "percentile_drop") {
        bench ||= await benchmarkFor(c); const m = bench?.ready && bench.metrics.find((x) => x.key === "reputation");
        if (m?.available && m.percentile != null && m.percentile < p.below) { await fire(r, companyId, { severity: "medium", message: `Your reputation health is now below the industry median (${m.percentile}th percentile).` }); fired++; }
      } else if (r.kind === "claim_inconsistency") {
        sig ||= await signals(c, { fresh: true }); const bad = sig.claims.find((x) => x.status === "differs");
        if (bad) { await fire(r, companyId, { severity: "medium", message: `Reports appear inconsistent with what you advertise about “${bad.topic || bad.claim}”.` }); fired++; }
      }
    } catch (e) { console.error("[company-alerts]", r.kind, e?.message); }
  }
  return { fired };
}
