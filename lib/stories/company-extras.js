// The rest of the company toolbox: Enterprise integrations (API, webhooks, IP allowlist, scheduled reports,
// peer groups) and employer tools (events, AMA, followers, newsletter, pulse surveys, employee advocacy).
//
// Same boundary as everything else: companies get COUNTS, never people.
//   * pulse answers are tied to a one-way HMAC, results show only from 8 answers
//   * followers, RSVPs, talent interest and advocacy are shown as totals, and only from 5
//   * the API returns the same aggregates the dashboard shows, never an author
import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import { contentDb, formatRelativeTime } from "../content/db.js";
import { identityDb, storiesIdentityReady } from "./identity-db.js";
import { createNotification, resolveAliasAccountId } from "../identity/service.js";
import { StoryError, normCompany } from "./service.js";
import { auditCompany, planOf } from "./business.js";
import { has, levelOf } from "../business-features.js";
import { callModel, isAiConfigured } from "../ai.js";
import { overview, reportData, benchmarkFor, signals } from "./company-intel.js";
import { MIN_COHORT } from "./company-metrics.js";

const nowIso = () => new Date().toISOString(), uid = () => crypto.randomUUID(), DAY = 864e5;
const clip = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const J = (v, f) => { try { return JSON.parse(v); } catch { return f; } };
const need = (ctx, perm) => { if (!ctx.can(perm)) throw new StoryError("Your role on this company can't do that.", 403, "ROLE_FORBIDDEN"); };
const feat = (ctx, f, label) => { if (!has(ctx.plan, f)) throw new StoryError(`${label} is part of a higher company plan.`, 403, "PLAN_REQUIRED"); };
export const MIN_PULSE = 8;

// A ctx for system callers (API key, scheduler): sees everything its plan includes, acts as nobody.
export async function systemCtx(companyId) {
  const c = await contentDb.prepare("SELECT id, name, industry, owner_key, verification, status FROM companies WHERE id = ? AND status = 'active'").get(companyId);
  if (!c) throw new StoryError("Company not found.", 404, "NOT_FOUND");
  const p = await planOf(companyId);
  return { c, key: null, role: "system", handle: "system", plan: p.plan, planInfo: p, perks: p.perks, verified: c.verification === "verified", can: () => true, has: (f) => has(p.plan, f) };
}

// ------------------------------------------------------------------ outbound safety: never let a webhook reach our own network
const PRIVATE = [/^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];
const privateIp = (ip) => (net.isIPv6(ip) ? /^(::1|fc|fd|fe80|::ffff:(10|127|169\.254|192\.168))/i.test(ip) : PRIVATE.some((r) => r.test(ip)));
export async function assertPublicHttps(raw) {
  let u; try { u = new URL(raw); } catch { throw new StoryError("That isn't a valid link."); }
  if (u.protocol !== "https:" || (u.port && u.port !== "443") || u.username || u.password) throw new StoryError("Use a plain https:// link on the standard port.");
  if (net.isIP(u.hostname)) throw new StoryError("Use a hostname, not an IP address.");
  const addrs = await dns.lookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new StoryError("That address isn't reachable from the public internet.");
  return u.toString();
}

// ------------------------------------------------------------------ API keys (Enterprise)
const hashKey = (k) => crypto.createHash("sha256").update(k).digest("hex");
export async function listApiKeys(ctx) {
  need(ctx, "settings.manage"); feat(ctx, "api", "The API");
  return (await contentDb.prepare("SELECT id, name, prefix, created_at, last_used_at FROM company_api_keys WHERE company_id = ? AND revoked_at IS NULL ORDER BY created_at DESC").all(ctx.c.id))
    .map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, created: formatRelativeTime(k.created_at), lastUsed: k.last_used_at ? formatRelativeTime(k.last_used_at) : "never" }));
}
export async function createApiKey(ctx, { name }) {
  need(ctx, "settings.manage"); feat(ctx, "api", "The API");
  const n = Number((await contentDb.prepare("SELECT COUNT(*) n FROM company_api_keys WHERE company_id = ? AND revoked_at IS NULL").get(ctx.c.id)).n);
  if (n >= 5) throw new StoryError("You can keep 5 active keys. Revoke one first.", 403, "PLAN_LIMIT");
  const raw = `lo_live_${crypto.randomBytes(24).toString("base64url")}`;
  await contentDb.prepare("INSERT INTO company_api_keys (id, company_id, name, prefix, key_hash, created_by, created_at) VALUES (?,?,?,?,?,?,?)").run(uid(), ctx.c.id, clip(name, 60) || "API key", raw.slice(0, 12), hashKey(raw), ctx.handle, nowIso());
  await auditCompany(ctx.c.id, ctx.handle, "api_key_created", clip(name, 60));
  return { key: raw, note: "Copy it now. It is never shown again." };
}
export async function revokeApiKey(ctx, { id }) { need(ctx, "settings.manage"); await contentDb.prepare("UPDATE company_api_keys SET revoked_at = ? WHERE id = ? AND company_id = ?").run(nowIso(), id, ctx.c.id); await auditCompany(ctx.c.id, ctx.handle, "api_key_revoked", id); return { ok: true }; }
const bucket = new Map();   // per-key sliding window; per-instance, which is enough to blunt abuse
export async function authApiKey(raw) {
  const k = await contentDb.prepare("SELECT id, company_id FROM company_api_keys WHERE key_hash = ? AND revoked_at IS NULL").get(hashKey(String(raw || "")));
  if (!k) return null;
  const now = Date.now(), w = (bucket.get(k.id) || []).filter((t) => now - t < 60000); if (w.length >= 60) throw new StoryError("Rate limit: 60 requests a minute.", 429, "RATE_LIMITED");
  w.push(now); bucket.set(k.id, w);
  await contentDb.prepare("UPDATE company_api_keys SET last_used_at = ? WHERE id = ?").run(nowIso(), k.id);
  const ctx = await systemCtx(k.company_id); if (!has(ctx.plan, "api")) throw new StoryError("This company's plan no longer includes the API.", 403, "PLAN_REQUIRED");
  return ctx;
}
export async function apiResource(ctx, resource) {
  const strip = (o) => o;
  if (resource === "reputation") { const o = await overview(ctx); return strip({ health: o.health, response: o.response, counts: o.counts, topIssues: o.topIssues, changed: o.changed || null, trend: o.trend ? { text: o.trend.text, points: o.trend.points } : null, percentile: o.percentile ?? null }); }
  if (resource === "benchmarks") return benchmarkFor(ctx.c);
  if (resource === "alerts") return { events: (await contentDb.prepare("SELECT kind, severity, message, created_at FROM company_alert_events WHERE company_id = ? ORDER BY created_at DESC LIMIT 100").all(ctx.c.id)) };
  if (resource === "stories") { const s = await signals(ctx.c), replied = new Set(s.replies.map((r) => r.story_id)); return { stories: s.rows.slice(0, 500).map((r) => ({ id: r.id, date: String(r.created_at).slice(0, 10), format: r.format, themes: r._t, answered: replied.has(r.id) })) }; }
  if (resource === "jobs") return { jobs: await contentDb.prepare("SELECT id, title, status, workplace_mode, employment_type, created_at FROM jobs WHERE company_id = ? ORDER BY created_at DESC LIMIT 200").all(ctx.c.id).catch(() => []) };
  throw new StoryError("Unknown resource. Try reputation, benchmarks, alerts, stories or jobs.", 400, "BAD_REQUEST");
}

// ------------------------------------------------------------------ webhooks (Slack, Teams, anything)
export async function listWebhooks(ctx) {
  need(ctx, "settings.manage"); feat(ctx, "webhooks", "Webhooks");
  return (await contentDb.prepare("SELECT id, kind, url, events, enabled, last_status, last_at FROM company_webhooks WHERE company_id = ? ORDER BY created_at").all(ctx.c.id))
    .map((w) => ({ id: w.id, kind: w.kind, host: new URL(w.url).hostname, events: J(w.events, []), enabled: !!w.enabled, lastStatus: w.last_status, lastAt: w.last_at ? formatRelativeTime(w.last_at) : null }));
}
export async function addWebhook(ctx, { kind, url, events }) {
  need(ctx, "settings.manage"); feat(ctx, "webhooks", "Webhooks");
  const n = Number((await contentDb.prepare("SELECT COUNT(*) n FROM company_webhooks WHERE company_id = ?").get(ctx.c.id)).n); if (n >= 10) throw new StoryError("You can keep 10 webhooks.", 403, "PLAN_LIMIT");
  const safe = await assertPublicHttps(clip(url, 500)), secret = crypto.randomBytes(24).toString("hex");
  const ev = (Array.isArray(events) ? events : ["alert"]).filter((e) => ["alert", "application", "report"].includes(e));
  await contentDb.prepare("INSERT INTO company_webhooks (id, company_id, kind, url, secret, events, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)").run(uid(), ctx.c.id, ["slack", "teams", "generic"].includes(kind) ? kind : "generic", safe, secret, JSON.stringify(ev.length ? ev : ["alert"]), ctx.handle, nowIso());
  await auditCompany(ctx.c.id, ctx.handle, "webhook_added", new URL(safe).hostname);
  return { secret, note: kind === "generic" ? "Requests are signed: X-LinkedOut-Signature: sha256=HMAC(secret, body). Shown once." : "Added." };
}
export async function deleteWebhook(ctx, { id }) { need(ctx, "settings.manage"); await contentDb.prepare("DELETE FROM company_webhooks WHERE id = ? AND company_id = ?").run(id, ctx.c.id); return { ok: true }; }
export async function deliverWebhooks(companyId, event, { text, data = {} }) {
  const hooks = await contentDb.prepare("SELECT * FROM company_webhooks WHERE company_id = ? AND enabled = 1").all(companyId).catch(() => []);
  for (const w of hooks) {
    if (!J(w.events, []).includes(event)) continue;
    let status = "ok";
    try {
      const url = await assertPublicHttps(w.url);   // re-check at send time (DNS can change)
      const body = JSON.stringify(w.kind === "generic" ? { event, text, data, at: nowIso() } : { text });
      const sig = crypto.createHmac("sha256", w.secret).update(body).digest("hex");
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-LinkedOut-Signature": `sha256=${sig}` }, body, redirect: "error", signal: AbortSignal.timeout(5000) });
      if (!r.ok) status = `http ${r.status}`;
    } catch (e) { status = `failed: ${String(e.message).slice(0, 60)}`; }
    await contentDb.prepare("UPDATE company_webhooks SET last_status = ?, last_at = ? WHERE id = ?").run(status, nowIso(), w.id).catch(() => {});
  }
}
export async function testWebhook(ctx, { id }) {
  need(ctx, "settings.manage"); const w = await contentDb.prepare("SELECT id FROM company_webhooks WHERE id = ? AND company_id = ?").get(id, ctx.c.id); if (!w) throw new StoryError("Not found.", 404, "NOT_FOUND");
  await deliverWebhooks(ctx.c.id, "alert", { text: `Test message from LinkedOut for ${ctx.c.name}.` }); return { ok: true };
}

// ------------------------------------------------------------------ IP allowlist (Enterprise)
const ipv4n = (ip) => ip.split(".").reduce((a, b) => (a << 8) + Number(b), 0) >>> 0;
export function ipMatches(ip, entry) {
  if (!ip) return false; if (!entry.includes("/")) return ip === entry;
  const [base, bits] = entry.split("/"); if (!net.isIPv4(base) || !net.isIPv4(ip)) return false;
  const m = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0; return (ipv4n(ip) & m) === (ipv4n(base) & m);
}
export async function ipAllowed(companyId, ip) {
  const r = await contentDb.prepare("SELECT ip_allowlist FROM company_settings WHERE company_id = ?").get(companyId);
  const list = J(r?.ip_allowlist, []); if (!list.length) return true;
  const p = await planOf(companyId); if (!has(p.plan, "ip_allowlist")) return true;
  return list.some((e) => ipMatches(ip, e));
}
export async function getIpAllowlist(ctx) { const r = await contentDb.prepare("SELECT ip_allowlist FROM company_settings WHERE company_id = ?").get(ctx.c.id); return J(r?.ip_allowlist, []); }
export async function saveIpAllowlist(ctx, { list }, ip) {
  need(ctx, "settings.manage"); feat(ctx, "ip_allowlist", "The IP allowlist");
  const l = (Array.isArray(list) ? list : String(list || "").split(/[\s,]+/)).map((x) => String(x).trim()).filter(Boolean).slice(0, 30);
  for (const e of l) { const [b, bits] = e.split("/"); if (!net.isIPv4(b) || (bits !== undefined && !(Number(bits) >= 8 && Number(bits) <= 32))) throw new StoryError(`“${e}” isn't an IPv4 address or range (like 203.0.113.0/24).`); }
  if (l.length && !l.some((e) => ipMatches(ip, e))) throw new StoryError(`That list wouldn't include your current address (${ip || "unknown"}), so it would lock you out. Add it first.`, 400, "LOCKOUT");
  await contentDb.prepare(`INSERT INTO company_settings (company_id, ip_allowlist, updated_at) VALUES (?,?,?) ON CONFLICT (company_id) DO UPDATE SET ip_allowlist = EXCLUDED.ip_allowlist, updated_at = EXCLUDED.updated_at`).run(ctx.c.id, JSON.stringify(l), nowIso());
  await auditCompany(ctx.c.id, ctx.handle, "ip_allowlist_changed", `${l.length} entries`); return { ok: true };
}

// ------------------------------------------------------------------ scheduled reports (Enterprise)
const nextRun = (cadence, from = Date.now()) => new Date(from + (cadence === "weekly" ? 7 : 30) * DAY).toISOString();
export async function getSchedule(ctx) { const s = await contentDb.prepare("SELECT cadence, roles, next_run, last_run FROM company_report_schedules WHERE company_id = ?").get(ctx.c.id); return s ? { cadence: s.cadence, roles: J(s.roles, []), nextRun: s.next_run, lastRun: s.last_run } : null; }
export async function saveSchedule(ctx, { cadence, roles, off }) {
  need(ctx, "settings.manage"); feat(ctx, "scheduled_reports", "Scheduled reports");
  if (off) { await contentDb.prepare("DELETE FROM company_report_schedules WHERE company_id = ?").run(ctx.c.id); return { ok: true }; }
  if (!["weekly", "monthly"].includes(cadence)) throw new StoryError("Pick weekly or monthly.");
  const r = (Array.isArray(roles) ? roles : ["owner"]).filter((x) => ["owner", "admin", "hr", "communications", "analyst", "executive", "moderator"].includes(x));
  await contentDb.prepare(`INSERT INTO company_report_schedules (company_id, cadence, roles, next_run, updated_by) VALUES (?,?,?,?,?)
    ON CONFLICT (company_id) DO UPDATE SET cadence = EXCLUDED.cadence, roles = EXCLUDED.roles, next_run = EXCLUDED.next_run, updated_by = EXCLUDED.updated_by`).run(ctx.c.id, cadence, JSON.stringify(r.length ? r : ["owner"]), nextRun(cadence), ctx.handle);
  await auditCompany(ctx.c.id, ctx.handle, "report_schedule_set", cadence); return { ok: true };
}
async function notifyRolesLocal(companyId, roles, message) {
  const c = await contentDb.prepare("SELECT owner_key FROM companies WHERE id = ?").get(companyId), want = new Set(roles), keys = new Set(); if (c?.owner_key) keys.add(c.owner_key);
  for (const r of await contentDb.prepare("SELECT anon_key, role FROM company_reps WHERE company_id = ?").all(companyId)) if (want.has(r.role === "responder" ? "communications" : r.role)) keys.add(r.anon_key);
  for (const k of keys) { const a = await resolveAliasAccountId(k).catch(() => null); if (a) await createNotification(a, "company_alert", message, null).catch(() => {}); }
}
// Called by the scheduler (instrumentation.js, hourly) and by /api/cron/company. Each due schedule is claimed atomically.
export async function runDueReports() {
  const due = await contentDb.prepare("SELECT * FROM company_report_schedules WHERE next_run <= ?").all(nowIso()); let sent = 0;
  for (const s of due) {
    const claim = await contentDb.prepare("UPDATE company_report_schedules SET next_run = ?, last_run = ? WHERE company_id = ? AND next_run = ?").run(nextRun(s.cadence), nowIso(), s.company_id, s.next_run);
    if (!claim.changes) continue;
    try {
      const ctx = await systemCtx(s.company_id); if (!has(ctx.plan, "scheduled_reports")) continue;
      const to = new Date().toISOString().slice(0, 10), from = new Date(Date.now() - (s.cadence === "weekly" ? 7 : 30) * DAY).toISOString().slice(0, 10);
      const r = await reportData(ctx, { from, to });
      const msg = `${ctx.c.name} ${s.cadence} report (${from} to ${to}): ${r.stories} stories, ${r.unanswered} unanswered, reputation health ${r.health.label}. ${r.trend} Open Reports in your Command Center for the full view.`;
      await notifyRolesLocal(s.company_id, J(s.roles, ["owner"]), msg); await deliverWebhooks(s.company_id, "report", { text: msg, data: { from, to } }); sent++;
    } catch (e) { console.error("[scheduled report]", s.company_id, e.message); }
  }
  return { sent };
}

// ------------------------------------------------------------------ peer group (Enterprise) and AI summary (Business Pro+)
export async function getPeerGroup(ctx) { const g = await contentDb.prepare("SELECT name, industries, sizes, places FROM company_peer_groups WHERE company_id = ?").get(ctx.c.id); return g ? { name: g.name, industries: J(g.industries, []), sizes: J(g.sizes, []), places: J(g.places, []) } : null; }
export async function savePeerGroup(ctx, { name, industries, sizes, places, off }) {
  need(ctx, "settings.manage"); feat(ctx, "competitor_groups", "Custom competitor groups");
  if (off) { await contentDb.prepare("DELETE FROM company_peer_groups WHERE company_id = ?").run(ctx.c.id); return { ok: true }; }
  const ind = [...new Set((Array.isArray(industries) ? industries : []).map((x) => clip(x, 60)).filter(Boolean))].slice(0, 8); if (!ind.length) throw new StoryError("Pick at least one industry.");
  const sz = (Array.isArray(sizes) ? sizes : []).filter((x) => ["1-49", "50-199", "200-999", "1,000-4,999", "5,000+"].includes(x)), pl = (Array.isArray(places) ? places : String(places || "").split(/[,\n]/)).map((x) => clip(x, 40)).filter(Boolean).slice(0, 6);
  await contentDb.prepare(`INSERT INTO company_peer_groups (company_id, name, industries, sizes, places, updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT (company_id) DO UPDATE SET name = EXCLUDED.name, industries = EXCLUDED.industries, sizes = EXCLUDED.sizes, places = EXCLUDED.places, updated_at = EXCLUDED.updated_at`).run(ctx.c.id, clip(name, 60) || "My peers", JSON.stringify(ind), JSON.stringify(sz), JSON.stringify(pl), nowIso());
  return { ok: true };
}
export async function industriesAvailable() { return (await contentDb.prepare("SELECT industry, COUNT(*) n FROM companies WHERE status = 'active' AND industry IS NOT NULL AND industry <> '' GROUP BY industry HAVING COUNT(*) >= 3 ORDER BY industry").all()).map((r) => r.industry); }
export async function aiSummary(ctx) {
  need(ctx, "insights.view"); feat(ctx, "ai_insights", "AI insight summaries");
  const o = await overview(ctx);
  const facts = [`Reputation health: ${o.health.label}${o.health.score != null ? ` (${o.health.score}/100)` : ""}`, `Stories this month: ${o.counts.storiesMonth} (previous month ${o.counts.storiesPrev}); unanswered: ${o.counts.unanswered}`,
    `Response: ${o.response.label}, rate ${o.response.rate ?? "n/a"}%, median ${o.response.medianHours ?? "n/a"}h`, o.trend ? `Trend: ${o.trend.text}` : "", o.emerging ? `Emerging issue: ${o.emerging.label} (${o.emerging.before} → ${o.emerging.reporters} people)` : "",
    ...(o.changed?.attention || []).map((x) => `Needs attention: ${x.text}`), ...(o.changed?.positive || []).map((x) => `Positive: ${x.text}`)].filter(Boolean);
  if (isAiConfigured()) {
    try { const t = await callModel({ maxTokens: 350, system: "You write a short executive summary of a company's workplace-reputation numbers for its leadership. Use ONLY the facts given. Describe what people reported, never what the company is. No advice beyond one suggested focus area. 4 short bullet points, plain language.", user: facts.join("\n") }); return { text: clip(t, 1400), ai: true }; } catch { /* fall through */ }
  }
  return { text: facts.map((f) => `• ${f}`).join("\n"), ai: false };
}

// ------------------------------------------------------------------ events and AMA (Business+)
export const EVENT_KINDS = ["career_fair", "webinar", "ama", "office_tour", "hiring_event", "graduate_recruitment"];
export async function listEvents(ctx) {
  need(ctx, "story.view"); feat(ctx, "events", "Events");
  const ev = await contentDb.prepare("SELECT id, kind, title, description, starts_at, url FROM company_events WHERE company_id = ? ORDER BY starts_at DESC LIMIT 60").all(ctx.c.id);
  const ids = ev.map((e) => e.id), rs = ids.length ? await contentDb.prepare("SELECT event_id, COUNT(*) n FROM company_event_rsvps WHERE event_id = ANY(?) GROUP BY event_id").all(ids) : [];
  const qs = ids.length ? await contentDb.prepare("SELECT id, event_id, question, answer, status FROM company_questions WHERE company_id = ? AND event_id = ANY(?) AND status <> 'hidden' ORDER BY created_at").all(ctx.c.id, ids) : [];
  return ev.map((e) => ({ ...e, startsAt: e.starts_at, upcoming: e.starts_at > nowIso(), rsvps: Number(rs.find((r) => r.event_id === e.id)?.n || 0), questions: qs.filter((q) => q.event_id === e.id) }));
}
export async function saveEvent(ctx, { kind, title, description, startsAt, url }) {
  need(ctx, "announce.publish"); feat(ctx, "events", "Events");
  if (!ctx.verified) throw new StoryError("Verify your company page before publishing events.", 403, "NOT_VERIFIED");
  const t = clip(title, 140), when = new Date(startsAt); if (t.length < 4 || isNaN(when)) throw new StoryError("Give the event a title and a start time.");
  const u = clip(url, 500); if (u && !/^https:\/\/[^\s]+$/.test(u)) throw new StoryError("Use a full https:// link.");
  const id = uid(); await contentDb.prepare("INSERT INTO company_events (id, company_id, kind, title, description, starts_at, url, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(id, ctx.c.id, EVENT_KINDS.includes(kind) ? kind : "webinar", t, clip(description, 1500) || null, when.toISOString(), u || null, ctx.handle, nowIso());
  await auditCompany(ctx.c.id, ctx.handle, "event_created", t); return { id };
}
export async function deleteEvent(ctx, { id }) { need(ctx, "announce.publish"); await contentDb.prepare("DELETE FROM company_event_rsvps WHERE event_id = ?").run(id); await contentDb.prepare("DELETE FROM company_events WHERE id = ? AND company_id = ?").run(id, ctx.c.id); return { ok: true }; }
export async function publicEvents(companyId, viewerKey) {
  const ev = await contentDb.prepare("SELECT id, kind, title, description, starts_at, url FROM company_events WHERE company_id = ? AND starts_at > ? ORDER BY starts_at LIMIT 10").all(companyId, new Date(Date.now() - 6 * 3600e3).toISOString());
  const mine = viewerKey ? new Set((await contentDb.prepare("SELECT event_id FROM company_event_rsvps WHERE anon_key = ?").all(viewerKey)).map((r) => r.event_id)) : new Set();
  const qs = ev.length ? await contentDb.prepare("SELECT event_id, question, answer FROM company_questions WHERE company_id = ? AND status = 'answered' AND event_id = ANY(?)").all(companyId, ev.map((e) => e.id)) : [];
  return ev.map((e) => ({ id: e.id, kind: e.kind, title: e.title, description: e.description, startsAt: e.starts_at, url: e.url, going: mine.has(e.id), answers: qs.filter((q) => q.event_id === e.id) }));
}
export async function rsvp(key, { eventId }) {
  const e = await contentDb.prepare("SELECT id FROM company_events WHERE id = ?").get(eventId); if (!e) throw new StoryError("Event not found.", 404, "NOT_FOUND");
  const had = await contentDb.prepare("SELECT 1 x FROM company_event_rsvps WHERE event_id = ? AND anon_key = ?").get(eventId, key);
  if (had) await contentDb.prepare("DELETE FROM company_event_rsvps WHERE event_id = ? AND anon_key = ?").run(eventId, key); else await contentDb.prepare("INSERT INTO company_event_rsvps (event_id, anon_key, created_at) VALUES (?,?,?) ON CONFLICT DO NOTHING").run(eventId, key, nowIso());
  return { going: !had };
}
export async function askAma(key, companyId, { eventId, question }) {
  const e = await contentDb.prepare("SELECT id FROM company_events WHERE id = ? AND company_id = ? AND kind = 'ama'").get(eventId, companyId); if (!e) throw new StoryError("That AMA isn't open.", 404, "NOT_FOUND");
  const text = clip(question, 400); if (text.length < 10) throw new StoryError("Ask a full question.");
  await contentDb.prepare("INSERT INTO company_questions (id, company_id, asker_key, question, status, created_at, event_id) VALUES (?,?,?,?,'open',?,?)").run(uid(), companyId, key, text, nowIso(), eventId); return { ok: true };
}

// ------------------------------------------------------------------ followers and newsletter
export async function followToggle(key, companyId) {
  const had = await contentDb.prepare("SELECT 1 x FROM company_followers WHERE company_id = ? AND anon_key = ?").get(companyId, key);
  if (had) await contentDb.prepare("DELETE FROM company_followers WHERE company_id = ? AND anon_key = ?").run(companyId, key); else await contentDb.prepare("INSERT INTO company_followers (company_id, anon_key, created_at) VALUES (?,?,?) ON CONFLICT DO NOTHING").run(companyId, key, nowIso());
  return { following: !had };
}
export async function followerCount(companyId) { const n = Number((await contentDb.prepare("SELECT COUNT(*) n FROM company_followers WHERE company_id = ?").get(companyId)).n); return n >= MIN_COHORT ? n : null; }
export async function listNewsletters(ctx) { need(ctx, "announce.publish"); return { followers: await followerCount(ctx.c.id), sent: await contentDb.prepare("SELECT id, subject, recipients, created_at FROM company_newsletters WHERE company_id = ? ORDER BY created_at DESC LIMIT 20").all(ctx.c.id) }; }
export async function sendNewsletter(ctx, { subject, body }) {
  need(ctx, "announce.publish"); feat(ctx, "newsletter", "The company newsletter");
  if (!ctx.verified) throw new StoryError("Verify your company page first.", 403, "NOT_VERIFIED");
  const s = clip(subject, 120), b = clip(body, 1500); if (s.length < 4 || b.length < 20) throw new StoryError("Add a subject and a message.");
  const last = await contentDb.prepare("SELECT created_at FROM company_newsletters WHERE company_id = ? ORDER BY created_at DESC LIMIT 1").get(ctx.c.id);
  if (last && Date.now() - new Date(last.created_at).getTime() < 6 * DAY) throw new StoryError("One newsletter every 6 days, so followers don't tune out.", 429, "RATE_LIMITED");
  const keys = (await contentDb.prepare("SELECT anon_key FROM company_followers WHERE company_id = ? LIMIT 5000").all(ctx.c.id)).map((r) => r.anon_key); let sent = 0;
  for (const k of keys) { const a = await resolveAliasAccountId(k).catch(() => null); if (a) { await createNotification(a, "company_update", `${ctx.c.name}: ${s}. ${b.slice(0, 160)}`, null).catch(() => {}); sent++; } }
  await contentDb.prepare("INSERT INTO company_newsletters (id, company_id, subject, body, recipients, created_by, created_at) VALUES (?,?,?,?,?,?,?)").run(uid(), ctx.c.id, s, b, sent, ctx.handle, nowIso());
  await auditCompany(ctx.c.id, ctx.handle, "newsletter_sent", `${sent} followers`); return { sent };
}

// ------------------------------------------------------------------ employee advocacy and pulse (verified employees only)
const pepper = () => process.env.IDENTITY_SIGNING_SECRET || "dev-only-pepper";
async function verifiedCurrent(accountId, companyId, companyName) {
  await storiesIdentityReady();
  return identityDb.prepare("SELECT id FROM employment_verifications WHERE account_id = ? AND status = 'verified' AND kind = 'current' AND expires_at > ? AND (company_id = ? OR company_key = ?)").get(accountId, nowIso(), companyId, normCompany(companyName));
}
export async function setAdvocacy(accountId, { verificationId, visible }) {
  await storiesIdentityReady();
  const r = await identityDb.prepare("UPDATE employment_verifications SET advocacy_visible = ? WHERE id = ? AND account_id = ? AND status = 'verified'").run(visible ? 1 : 0, verificationId, accountId);
  if (!r.changes) throw new StoryError("Verify your employment first.", 404, "NOT_FOUND"); return { ok: true };
}
export async function advocacyCount(companyId, companyName) {
  await storiesIdentityReady();
  const n = Number((await identityDb.prepare("SELECT COUNT(DISTINCT account_id) n FROM employment_verifications WHERE status = 'verified' AND kind = 'current' AND advocacy_visible = 1 AND expires_at > ? AND (company_id = ? OR company_key = ?)").get(nowIso(), companyId, normCompany(companyName))).n);
  return n >= MIN_COHORT ? n : null;
}
const PULSE_Q = ["I would recommend working here to a friend.", "I understand what is expected of me.", "I trust the people who manage me.", "I can sustain my current workload.", "I see a future for myself here."];
export const PULSE_QUESTIONS = PULSE_Q;
export async function createPulse(ctx, { title, questions }) {
  need(ctx, "settings.manage"); feat(ctx, "pulse", "Pulse surveys");
  const open = await contentDb.prepare("SELECT 1 x FROM company_pulses WHERE company_id = ? AND status = 'open'").get(ctx.c.id); if (open) throw new StoryError("Close the open pulse first.", 400, "BAD_REQUEST");
  const qs = (Array.isArray(questions) ? questions : []).map((q) => clip(q, 160)).filter((q) => q.length >= 8).slice(0, 5); if (qs.length < 1) throw new StoryError("Add 1 to 5 statements people can rate from 1 to 5.");
  const id = uid(); await contentDb.prepare("INSERT INTO company_pulses (id, company_id, title, questions, created_by, created_at) VALUES (?,?,?,?,?,?)").run(id, ctx.c.id, clip(title, 100) || "Employee pulse", JSON.stringify(qs), ctx.handle, nowIso());
  await auditCompany(ctx.c.id, ctx.handle, "pulse_opened", clip(title, 60)); return { id };
}
export async function closePulse(ctx, { id }) { need(ctx, "settings.manage"); await contentDb.prepare("UPDATE company_pulses SET status = 'closed', closed_at = ? WHERE id = ? AND company_id = ?").run(nowIso(), id, ctx.c.id); return { ok: true }; }
function pulseResults(p, rows) {
  const qs = J(p.questions, []), n = rows.length;
  if (n < MIN_PULSE) return { responses: n, hidden: true, note: `Results appear once ${MIN_PULSE} verified employees have answered (${n} so far). This protects anyone from being identified.` };
  const all = rows.map((r) => J(r.answers, []));
  return { responses: n, hidden: false, questions: qs.map((q, i) => { const v = all.map((a) => Number(a[i])).filter((x) => x >= 1 && x <= 5), t = v.length || 1; return { q, positive: Math.round((v.filter((x) => x >= 4).length / t) * 100), neutral: Math.round((v.filter((x) => x === 3).length / t) * 100), negative: Math.round((v.filter((x) => x <= 2).length / t) * 100) }; }) };
}
export async function listPulses(ctx) {
  need(ctx, "insights.view"); feat(ctx, "pulse", "Pulse surveys");
  const ps = await contentDb.prepare("SELECT * FROM company_pulses WHERE company_id = ? ORDER BY created_at DESC LIMIT 12").all(ctx.c.id), out = [];
  for (const p of ps) out.push({ id: p.id, title: p.title, status: p.status, created: formatRelativeTime(p.created_at), ...pulseResults(p, await contentDb.prepare("SELECT answers FROM company_pulse_responses WHERE pulse_id = ?").all(p.id)) });
  return { pulses: out, suggestions: PULSE_Q, verifiedEmployees: await advocacyCount(ctx.c.id, ctx.c.name) };
}
export async function myPulse(accountId, companyId) {
  const c = await contentDb.prepare("SELECT id, name FROM companies WHERE id = ? AND status = 'active'").get(companyId); if (!c) return null;
  const p = await contentDb.prepare("SELECT id, title, questions FROM company_pulses WHERE company_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1").get(companyId); if (!p) return null;
  if (!(await verifiedCurrent(accountId, companyId, c.name))) return null;
  const hash = crypto.createHmac("sha256", pepper()).update(`pulse:${p.id}:${accountId}`).digest("hex");
  const done = await contentDb.prepare("SELECT 1 x FROM company_pulse_responses WHERE pulse_id = ? AND voter_hash = ?").get(p.id, hash);
  return { id: p.id, title: p.title, questions: J(p.questions, []), answered: !!done };
}
export async function answerPulse(accountId, companyId, { pulseId, answers }) {
  const mine = await myPulse(accountId, companyId); if (!mine || mine.id !== pulseId) throw new StoryError("This pulse isn't open to you. It's for verified current employees.", 403, "NOT_ELIGIBLE");
  if (mine.answered) throw new StoryError("You've already answered.", 400, "DUPLICATE");
  const a = (Array.isArray(answers) ? answers : []).map((x) => Math.round(Number(x))); if (a.length !== mine.questions.length || a.some((x) => !(x >= 1 && x <= 5))) throw new StoryError("Rate every statement from 1 to 5.");
  const hash = crypto.createHmac("sha256", pepper()).update(`pulse:${pulseId}:${accountId}`).digest("hex");
  await contentDb.prepare("INSERT INTO company_pulse_responses (pulse_id, voter_hash, answers, created_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING").run(pulseId, hash, JSON.stringify(a), nowIso().slice(0, 10)); // date only: no timestamp to correlate
  return { ok: true };
}
