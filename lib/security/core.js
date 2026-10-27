// Security operations core: alerts -> incidents -> safe containment -> permanent-fix tasks.
// Design rules for automatic containment (so it can never take the platform down by accident):
//  * default mode is "recommend": actions are proposed and a human approves them with one click
//  * auto mode only ever acts on ONE IP or ONE ordinary account, never staff, never allow-listed IPs,
//    never a country/range; every automatic action has a TTL and is reversible
//  * a circuit breaker drops auto mode back to "recommend" if too many automatic actions fire in a short time
//  * a kill switch reverts every automatic action immediately and stops further ones
//  * manual actions refuse to block the admin's own IP (self-lockout guard)
import crypto from "node:crypto";
import { identityDb } from "@/lib/identity/db";
import { invalidateSession } from "@/lib/session-cache";

const now = () => new Date().toISOString();
const minutes = (m) => new Date(Date.now() + m * 60000).toISOString();
const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
const J = (v) => JSON.stringify(v ?? {});
const P = (s, d = {}) => { try { return JSON.parse(s); } catch { return d; } };

export const ALERT_TYPES = {
  impossible_travel: { sev: "low", label: "Impossible travel", auto: [], fix: "impossible_travel" },
  new_device: { sev: "low", label: "New device registered", auto: [], fix: "new_device" },
  policy_deviation: { sev: "low", label: "Policy deviation", auto: [], fix: "policy_deviation" },
  rate_limit_breach: { sev: "medium", label: "Rate-limit breach (scraping)", auto: [{ action: "throttle_ip", ttlMin: 15 }], fix: "rate_limit_breach" },
  mass_download: { sev: "medium", label: "Mass file modification / download", auto: [{ action: "disable_downloads", ttlMin: 60 }], fix: "mass_download" },
  auth_failures: { sev: "medium", label: "Repeated authentication failures", auto: [{ action: "tarpit_ip", ttlMin: 30 }], fix: "auth_failures" },
  honeytoken_access: { sev: "critical", label: "Honeytoken / honeypot access", auto: [{ action: "block_ip", ttlMin: 1440 }], fix: "honeytoken_access" },
  mfa_fatigue: { sev: "high", label: "MFA fatigue / spamming", auto: [{ action: "lock_account", ttlMin: 60 }], fix: "mfa_fatigue" },
  privilege_escalation: { sev: "high", label: "Privilege escalation", auto: [{ action: "freeze_role_changes", ttlMin: 30 }], fix: "privilege_escalation" },
  waf_match: { sev: "high", label: "WAF exploit match", auto: [{ action: "block_ip", ttlMin: 120 }], fix: "waf_match" },
  circuit_breaker: { sev: "critical", label: "Containment circuit breaker tripped", auto: [], fix: "circuit_breaker" },
  drill: { sev: "low", label: "Security drill", auto: [], fix: "drill" },
};
const SEV_RANK = { low: 0, medium: 1, high: 2, critical: 3 };

// Every quick measure the SOC can run. `target` says what it needs; `reversible` means one-click undo.
export const ACTIONS = {
  block_ip: { label: "Block IP", target: "ip", ttlMin: 1440, kind: "rule" },
  tarpit_ip: { label: "Tarpit IP (slow every response)", target: "ip", ttlMin: 30, kind: "rule" },
  throttle_ip: { label: "Throttle IP (hard request cap)", target: "ip", ttlMin: 15, kind: "rule" },
  geo_block: { label: "Block a country", target: "country", ttlMin: 240, kind: "rule", manualOnly: true },
  lock_account: { label: "Temporarily lock account", target: "account", ttlMin: 60, kind: "flag" },
  disable_downloads: { label: "Disable exports/downloads for account", target: "account", ttlMin: 60, kind: "flag" },
  force_password_reset: { label: "Force password reset", target: "account", ttlMin: 0, kind: "oneway" },
  freeze_role_changes: { label: "Freeze role and permission changes", target: "system", ttlMin: 30, kind: "setting" },
  notify_admins: { label: "Notify on-call admins", target: "system", ttlMin: 0, kind: "oneway" },
};

let ready = null;
async function init() {
  if (!ready) ready = (async () => {
    await identityDb.exec(`
      CREATE TABLE IF NOT EXISTS sec_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sec_events (kind TEXT NOT NULL, key TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS sec_events_idx ON sec_events (kind, key, created_at);
      CREATE TABLE IF NOT EXISTS sec_alerts (id TEXT PRIMARY KEY, type TEXT NOT NULL, severity TEXT NOT NULL, title TEXT NOT NULL, subject TEXT, subject_kind TEXT, ip TEXT, account_id TEXT,
        detail TEXT, count INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'open', incident_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS sec_alerts_idx ON sec_alerts (status, severity, created_at);
      CREATE TABLE IF NOT EXISTS sec_incidents (id TEXT PRIMARY KEY, title TEXT NOT NULL, severity TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', summary TEXT, owner TEXT, recommendation TEXT,
        timeline TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, resolved_at TEXT);
      CREATE TABLE IF NOT EXISTS sec_actions (id TEXT PRIMARY KEY, action TEXT NOT NULL, target TEXT, params TEXT, mode TEXT NOT NULL, status TEXT NOT NULL, actor TEXT, alert_id TEXT, incident_id TEXT,
        note TEXT, created_at TEXT NOT NULL, expires_at TEXT, reverted_at TEXT);
      CREATE TABLE IF NOT EXISTS sec_rules (id TEXT PRIMARY KEY, kind TEXT NOT NULL, value TEXT NOT NULL, effect TEXT NOT NULL, reason TEXT, expires_at TEXT, action_id TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sec_account_flags (account_id TEXT NOT NULL, flag TEXT NOT NULL, expires_at TEXT, action_id TEXT, PRIMARY KEY (account_id, flag));
      CREATE TABLE IF NOT EXISTS sec_allowlist (value TEXT PRIMARY KEY, note TEXT, created_by TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sec_tasks (id TEXT PRIMARY KEY, incident_id TEXT, alert_id TEXT, title TEXT NOT NULL, detail TEXT, owner_role TEXT, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL, done_by TEXT, done_at TEXT);
      CREATE TABLE IF NOT EXISTS sec_honeytokens (token TEXT PRIMARY KEY, kind TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sec_devices (account_id TEXT NOT NULL, device TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, country TEXT, PRIMARY KEY (account_id, device));
      CREATE TABLE IF NOT EXISTS sec_logins (account_id TEXT NOT NULL, country TEXT, ip TEXT, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS sec_logins_idx ON sec_logins (account_id, created_at);
      CREATE TABLE IF NOT EXISTS sec_policies (id TEXT PRIMARY KEY, name TEXT NOT NULL, perms TEXT NOT NULL, conditions TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_by TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sec_jit (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, from_role TEXT NOT NULL, to_role TEXT NOT NULL, reason TEXT NOT NULL, granted_by TEXT, expires_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL);
    `);
    // Seed honeytokens once: decoy credentials that no real user or service ever holds.
    const have = await identityDb.prepare("SELECT COUNT(*) c FROM sec_honeytokens").get();
    if (!+have.c) for (const [token, kind, note] of [
      [`lo_live_${crypto.randomBytes(12).toString("hex")}`, "api_key", "Decoy API key"],
      [`lo_admin_${crypto.randomBytes(10).toString("hex")}`, "admin_token", "Decoy admin token"],
      ["backup.admin@linkedout.invalid", "account", "Decoy admin account email"],
    ]) await identityDb.prepare("INSERT INTO sec_honeytokens (token, kind, note, created_at) VALUES (?,?,?,?)").run(token, kind, note, now());
  })().catch((e) => { ready = null; throw e; });
  return ready;
}
export const securityReady = init;

// ---------- settings ----------
const DEFAULTS = { mode: "recommend", maxAutoPerHour: "8", killSwitch: "0", freezeRoleChangesUntil: "", attackMode: "0", webauthnOnly: "0", emailMfa: "1" };
export async function getSettings() {
  await init();
  const rows = await identityDb.prepare("SELECT key, value FROM sec_settings").all();
  const s = { ...DEFAULTS }; for (const r of rows) s[r.key] = r.value;
  return { mode: ["off", "recommend", "auto"].includes(s.mode) ? s.mode : "recommend", maxAutoPerHour: Math.max(1, Math.min(60, +s.maxAutoPerHour || 8)), killSwitch: s.killSwitch === "1", freezeRoleChangesUntil: s.freezeRoleChangesUntil || "", attackMode: s.attackMode === "1", webauthnOnly: s.webauthnOnly === "1", emailMfa: s.emailMfa !== "0" };
}
async function setSetting(key, value) {
  await identityDb.prepare("INSERT INTO sec_settings (key, value) VALUES (?,?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, String(value));
}
export async function assertRoleChangesAllowed() {
  const s = await getSettings();
  if (s.freezeRoleChangesUntil && s.freezeRoleChangesUntil > now()) throw bad("Role and permission changes are frozen by a security containment measure. A security admin can lift the freeze in Security Operations.", 423);
}

// ---------- events / request info ----------
export async function recordEvent(kind, key) { await init(); await identityDb.prepare("INSERT INTO sec_events (kind, key, created_at) VALUES (?,?,?)").run(kind, String(key), now()); }
export async function countEvents(kind, key, windowMs) {
  await init();
  return +(await identityDb.prepare("SELECT COUNT(*) c FROM sec_events WHERE kind = ? AND key = ? AND created_at > ?").get(kind, String(key), new Date(Date.now() - windowMs).toISOString())).c;
}
export async function requestInfo() {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const ip = (h.get("fly-client-ip") || h.get("cf-connecting-ip") || (h.get("x-forwarded-for") || "").split(",")[0] || h.get("x-real-ip") || "").trim() || null;
    const country = (h.get("cf-ipcountry") || h.get("x-vercel-ip-country") || h.get("x-country") || "").toUpperCase() || null;
    const ua = h.get("user-agent") || "";
    return { ip, country: country && country !== "XX" ? country : null, ua, lang: h.get("accept-language") || "" };
  } catch { return { ip: null, country: null, ua: "", lang: "" }; }
}
export const maskIp = (ip) => !ip ? "" : ip.includes(":") ? ip.split(":").slice(0, 3).join(":") + ":…" : ip.split(".").slice(0, 2).join(".") + ".•.•";
export const maskEmail = (e) => String(e || "").replace(/^(.).*(@.*)$/, "$1•••$2");

// ---------- alerts ----------
export async function raiseAlert({ type, subject = null, subjectKind = "system", ip = null, accountId = null, detail = {}, title, dedupeMin = 15 }) {
  await init();
  const def = ALERT_TYPES[type]; if (!def) throw bad("Unknown alert type.");
  const key = subject || ip || accountId || "system";
  const open = await identityDb.prepare("SELECT * FROM sec_alerts WHERE type = ? AND COALESCE(subject, ip, account_id, 'system') = ? AND status IN ('open','ack') AND created_at > ? ORDER BY created_at DESC LIMIT 1")
    .get(type, key, new Date(Date.now() - dedupeMin * 60000).toISOString());
  if (open) { await identityDb.prepare("UPDATE sec_alerts SET count = count + 1, updated_at = ? WHERE id = ?").run(now(), open.id); return { id: open.id, deduped: true }; }
  const id = crypto.randomUUID();
  await identityDb.prepare("INSERT INTO sec_alerts (id,type,severity,title,subject,subject_kind,ip,account_id,detail,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, type, def.sev, title || def.label, subject, subjectKind, ip, accountId, J(detail), now(), now());
  const alert = { id, type, severity: def.sev, ip, accountId, subject, detail };
  import("./siem").then((m) => m.forwardEvent("alert", { id, type, severity: def.sev, title: title || def.label, ip, accountId, detail })).catch(() => {});
  if (ip) import("./reputation").then(async (m) => { const r = await m.ipReputation(ip); if (r.score) await identityDb.prepare("UPDATE sec_alerts SET detail = ? WHERE id = ?").run(J({ ...detail, ipReputation: r }), id); }).catch(() => {});
  try { alert.incidentId = await linkIncident(alert, title || def.label); } catch (e) { console.error("[sec] incident link failed:", e?.message); }
  try { await containment(alert); } catch (e) { console.error("[sec] containment failed:", e?.message); }
  return { id, incidentId: alert.incidentId };
}
// High and critical alerts open (or join) an incident automatically.
async function linkIncident(alert, title) {
  if (SEV_RANK[alert.severity] < 2) return null;
  const key = alert.ip || alert.accountId || alert.subject;
  let inc = key && await identityDb.prepare("SELECT i.id FROM sec_incidents i JOIN sec_alerts a ON a.incident_id = i.id WHERE i.status <> 'resolved' AND COALESCE(a.ip, a.account_id, a.subject) = ? LIMIT 1").get(key);
  const id = inc?.id || crypto.randomUUID();
  if (!inc) await identityDb.prepare("INSERT INTO sec_incidents (id,title,severity,status,summary,timeline,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(id, title, alert.severity, "open", null, "[]", now(), now());
  await identityDb.prepare("UPDATE sec_alerts SET incident_id = ? WHERE id = ?").run(id, alert.id);
  await timeline(id, `Alert raised: ${title}`);
  const cur = await identityDb.prepare("SELECT severity FROM sec_incidents WHERE id = ?").get(id);
  if (SEV_RANK[alert.severity] > SEV_RANK[cur.severity]) await identityDb.prepare("UPDATE sec_incidents SET severity = ?, updated_at = ? WHERE id = ?").run(alert.severity, now(), id);
  return id;
}
async function timeline(incidentId, text, actor = "system") {
  if (!incidentId) return;
  const r = await identityDb.prepare("SELECT timeline FROM sec_incidents WHERE id = ?").get(incidentId); if (!r) return;
  const t = P(r.timeline, []); t.push({ at: now(), by: actor, text: String(text).slice(0, 300) });
  await identityDb.prepare("UPDATE sec_incidents SET timeline = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(t.slice(-200)), now(), incidentId);
}

// ---------- containment ----------
async function isProtectedIp(ip) {
  if (!ip) return true;
  if (/^(127\.|10\.|192\.168\.|::1$|fc|fd|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) return true;
  return !!(await identityDb.prepare("SELECT 1 x FROM sec_allowlist WHERE value = ?").get(ip));
}
async function isStaffAccount(id) { const r = await identityDb.prepare("SELECT role FROM accounts WHERE id = ?").get(id); return !r || r.role !== "user"; }
async function autoSafe(def, alert) {
  if (def.manualOnly) return "this measure is manual-only";
  if (def.target === "ip") { if (await isProtectedIp(alert.ip)) return "IP is private, missing or allow-listed"; }
  if (def.target === "account") { if (!alert.accountId) return "no account on the alert"; if (await isStaffAccount(alert.accountId)) return "staff accounts are never auto-contained"; }
  return null;
}
async function containment(alert) {
  const plan = ALERT_TYPES[alert.type].auto || [];
  if (!plan.length) return;
  const s = await getSettings();
  if (s.mode === "off") return;
  for (const step of plan) {
    const def = ACTIONS[step.action];
    const target = def.target === "ip" ? alert.ip : def.target === "account" ? alert.accountId : "system";
    const blocked = await autoSafe(def, alert);
    if (blocked) { await timeline(alert.incidentId, `Auto-containment skipped (${def.label}): ${blocked}.`); continue; }
    const live = s.mode === "auto" && !s.killSwitch;
    if (live) {
      const recent = +(await identityDb.prepare("SELECT COUNT(*) c FROM sec_actions WHERE mode = 'auto' AND status = 'applied' AND created_at > ?").get(new Date(Date.now() - 3600000).toISOString())).c;
      if (recent >= s.maxAutoPerHour) { await tripBreaker(recent); await proposeOnly(alert, step, target, "circuit breaker"); continue; }
    }
    if (live) await applyAction({ action: step.action, target, mode: "auto", actor: "system", alertId: alert.id, incidentId: alert.incidentId, ttlMin: step.ttlMin, note: `Automatic response to ${ALERT_TYPES[alert.type].label}` });
    else await proposeOnly(alert, step, target, s.killSwitch ? "kill switch on" : "recommend mode");
  }
}
async function proposeOnly(alert, step, target, why) {
  const id = crypto.randomUUID();
  await identityDb.prepare("INSERT INTO sec_actions (id,action,target,params,mode,status,actor,alert_id,incident_id,note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, step.action, target, J({ ttlMin: step.ttlMin }), "auto", "proposed", "system", alert.id, alert.incidentId || null, `Proposed (${why}). Approve to apply.`, now());
  await timeline(alert.incidentId, `Recommended: ${ACTIONS[step.action].label} on ${target || "system"} (${why}).`);
}
async function tripBreaker(n) {
  await setSetting("mode", "recommend");
  await raiseAlert({ type: "circuit_breaker", subject: "containment", detail: { autoActionsLastHour: n, note: "Automatic containment switched to recommend-only." }, dedupeMin: 60 });
}

export async function applyAction({ action, target, mode = "manual", actor = "system", alertId = null, incidentId = null, ttlMin = null, note = "", actingIp = null, proposedId = null }) {
  await init();
  const def = ACTIONS[action]; if (!def) throw bad("Unknown action.");
  if (def.target !== "system" && !target) throw bad("This action needs a target.");
  const ttl = ttlMin ?? def.ttlMin;
  if (def.target === "ip") {
    if (!/^[0-9a-fA-F:.]{3,45}$/.test(target)) throw bad("That doesn't look like an IP address.");
    if (actingIp && actingIp === target && action === "block_ip") throw bad("That is your own IP. Blocking it would lock you out.", 409);
    if (/^(127\.|10\.|192\.168\.|::1$|172\.(1[6-9]|2\d|3[01])\.)/.test(target)) throw bad("Private and loopback addresses can't be blocked.", 409);
    if (mode === "manual" && action === "block_ip" && await identityDb.prepare("SELECT 1 x FROM sec_allowlist WHERE value = ?").get(target)) throw bad("That IP is on the allow-list. Remove it from the allow-list first.", 409);
  }
  if (def.target === "country" && !/^[A-Za-z]{2}$/.test(target)) throw bad("Use a 2-letter country code.");
  if (def.target === "account") {
    if (await isStaffAccount(target) && mode === "auto") throw bad("Staff accounts are never auto-contained.");
    if (target === actor) throw bad("You can't contain your own account.", 409);
  }
  const id = proposedId || crypto.randomUUID();
  const expires = ttl ? minutes(ttl) : null;
  if (def.kind === "rule") {
    const effect = action === "block_ip" || action === "geo_block" ? "block" : action === "tarpit_ip" ? "tarpit" : "throttle";
    await identityDb.prepare("INSERT INTO sec_rules (id,kind,value,effect,reason,expires_at,action_id,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(crypto.randomUUID(), def.target, def.target === "country" ? target.toUpperCase() : target, effect, note || def.label, expires, id, now());
    invalidateRulesCache();
  } else if (def.kind === "flag") {
    const flag = action === "lock_account" ? "locked" : "no_downloads";
    await identityDb.prepare("INSERT INTO sec_account_flags (account_id, flag, expires_at, action_id) VALUES (?,?,?,?) ON CONFLICT (account_id, flag) DO UPDATE SET expires_at = excluded.expires_at, action_id = excluded.action_id").run(target, flag, expires, id);
    flagsAt = 0; invalidateSession(target);
  } else if (action === "freeze_role_changes") {
    await setSetting("freezeRoleChangesUntil", expires || minutes(30));
  } else if (action === "force_password_reset") {
    await identityDb.prepare("UPDATE accounts SET must_reset_password = 1 WHERE id = ?").run(target); invalidateSession(target);
  }
  if (proposedId) await identityDb.prepare("UPDATE sec_actions SET status='applied', mode='manual', actor=?, expires_at=?, note=COALESCE(note,'') || ' Approved.' WHERE id=?").run(actor, expires, id);
  else await identityDb.prepare("INSERT INTO sec_actions (id,action,target,params,mode,status,actor,alert_id,incident_id,note,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, action, def.target === "system" ? "system" : target, J({ ttlMin: ttl }), mode, "applied", actor, alertId, incidentId, note, now(), expires);
  import("./siem").then((m) => m.forwardEvent("containment", { id, action, target, mode, actor, ttlMin: ttl, incidentId })).catch(() => {});
  await timeline(incidentId, `${mode === "auto" ? "Automatic" : "Manual"} action: ${def.label}${def.target !== "system" ? ` on ${target}` : ""}${ttl ? ` for ${ttl} min` : ""}.`, actor);
  return { id };
}
export async function revertAction(id, actor = "system", reason = "reverted") {
  await init();
  const a = await identityDb.prepare("SELECT * FROM sec_actions WHERE id = ?").get(id);
  if (!a) throw bad("No such action.", 404);
  if (a.status === "proposed") { await identityDb.prepare("UPDATE sec_actions SET status='dismissed', reverted_at=? WHERE id=?").run(now(), id); return { ok: true }; }
  if (a.status !== "applied") return { ok: true };
  const def = ACTIONS[a.action];
  if (def?.kind === "rule") { await identityDb.prepare("DELETE FROM sec_rules WHERE action_id = ?").run(id); invalidateRulesCache(); }
  else if (def?.kind === "flag") { await identityDb.prepare("DELETE FROM sec_account_flags WHERE action_id = ?").run(id); flagsAt = 0; invalidateSession(a.target); }
  else if (a.action === "freeze_role_changes") await setSetting("freezeRoleChangesUntil", "");
  await identityDb.prepare("UPDATE sec_actions SET status = ?, reverted_at = ? WHERE id = ?").run(reason === "expired" ? "expired" : "reverted", now(), id);
  await timeline(a.incident_id, `${reason === "expired" ? "Expired" : "Reverted"}: ${def?.label || a.action} on ${a.target}.`, actor);
  return { ok: true };
}
export async function sweepExpired() {
  await init();
  const due = await identityDb.prepare("SELECT id FROM sec_actions WHERE status = 'applied' AND expires_at IS NOT NULL AND expires_at < ?").all(now());
  for (const d of due) await revertAction(d.id, "system", "expired").catch(() => {});
  await identityDb.prepare("DELETE FROM sec_rules WHERE expires_at IS NOT NULL AND expires_at < ?").run(now());
  await identityDb.prepare("DELETE FROM sec_account_flags WHERE expires_at IS NOT NULL AND expires_at < ?").run(now());
  const jit = await identityDb.prepare("SELECT * FROM sec_jit WHERE status = 'active' AND expires_at < ?").all(now());
  for (const j of jit) await endJit(j, "expired");
}
// Kill switch: revert every automatic action now and stop automatic containment.
export async function killSwitch(actor, on) {
  await init();
  await setSetting("killSwitch", on ? "1" : "0");
  let n = 0;
  if (on) { const autos = await identityDb.prepare("SELECT id FROM sec_actions WHERE mode = 'auto' AND status IN ('applied','proposed')").all(); for (const a of autos) { await revertAction(a.id, actor); n++; } }
  return { reverted: n };
}

// ---------- enforcement caches ----------
let rulesCache = null, rulesAt = 0, flags = new Map(), flagsAt = 0;
function invalidateRulesCache() { rulesAt = 0; }
export async function blocklistPayload() {
  await init(); await sweepExpired();
  const rules = await identityDb.prepare("SELECT kind, value, effect FROM sec_rules").all();
  const tokens = (await identityDb.prepare("SELECT token FROM sec_honeytokens").all()).map((t) => t.token);
  const allow = (await identityDb.prepare("SELECT value FROM sec_allowlist").all()).map((r) => r.value);
  const s = await getSettings();
  return { rules, tokens, allow, killSwitch: s.killSwitch, attackMode: s.attackMode };
}
async function loadFlags() {
  if (Date.now() - flagsAt < 10000) return;
  flagsAt = Date.now();
  try { await init(); const rows = await identityDb.prepare("SELECT account_id, flag, expires_at FROM sec_account_flags").all(); flags = new Map(rows.filter((r) => !r.expires_at || r.expires_at > now()).map((r) => [`${r.account_id}:${r.flag}`, true])); } catch { /* keep old */ }
}
export async function accountFlag(accountId, flag) { await loadFlags(); return flags.has(`${accountId}:${flag}`); }

// ---------- detection hooks ----------
export async function noteAuthFailure({ email, ip }) {
  try {
    await init();
    const tokens = await identityDb.prepare("SELECT token FROM sec_honeytokens WHERE kind = 'account'").all();
    if (email && tokens.some((t) => t.token === email)) { await raiseAlert({ type: "honeytoken_access", subject: `honey-account:${email}`, ip, subjectKind: "ip", detail: { how: "login attempt with a decoy admin account", email } }); return; }
    if (ip) await recordEvent("auth_fail_ip", ip);
    if (email) await recordEvent("auth_fail_acct", email);
    const byIp = ip ? await countEvents("auth_fail_ip", ip, 10 * 60000) : 0;
    const byAcct = email ? await countEvents("auth_fail_acct", email, 10 * 60000) : 0;
    if (byIp >= 8 || byAcct >= 6) await raiseAlert({ type: "auth_failures", subject: ip || email, subjectKind: ip ? "ip" : "account", ip, detail: { failuresFromIp: byIp, failuresForAccount: byAcct, window: "10 min", target: maskEmail(email) } });
  } catch (e) { console.error("[sec] noteAuthFailure", e?.message); }
}
export async function noteLogin(accountId) {
  try {
    await init();
    const { ip, country, ua, lang } = await requestInfo();
    const device = crypto.createHash("sha256").update(`${ua}|${lang}`).digest("hex").slice(0, 16);
    const known = await identityDb.prepare("SELECT 1 x FROM sec_devices WHERE account_id = ? AND device = ?").get(accountId, device);
    const first = await identityDb.prepare("SELECT 1 x FROM sec_devices WHERE account_id = ? LIMIT 1").get(accountId);
    if (!known) {
      await identityDb.prepare("INSERT INTO sec_devices (account_id, device, first_seen, last_seen, country) VALUES (?,?,?,?,?)").run(accountId, device, now(), now(), country);
      if (first) import("@/lib/email").then(async (m) => { const a = await identityDb.prepare("SELECT email FROM accounts WHERE id = ?").get(accountId); if (a?.email) await m.sendNewSignInEmail(a.email, { device: ua.slice(0, 90), country, when: new Date().toUTCString() }); }).catch(() => {});
      if (first) await raiseAlert({ type: "new_device", subject: `${accountId}:${device}`, accountId, ip, subjectKind: "account", detail: { device: ua.slice(0, 80), country }, dedupeMin: 60 });
    } else await identityDb.prepare("UPDATE sec_devices SET last_seen = ? WHERE account_id = ? AND device = ?").run(now(), accountId, device);
    if (country) {
      const last = await identityDb.prepare("SELECT country, created_at FROM sec_logins WHERE account_id = ? AND country IS NOT NULL ORDER BY created_at DESC LIMIT 1").get(accountId);
      if (last && last.country !== country && Date.now() - new Date(last.created_at).getTime() < 3 * 3600000)
        await raiseAlert({ type: "impossible_travel", subject: accountId, accountId, ip, subjectKind: "account", detail: { from: last.country, to: country, minutesBetween: Math.round((Date.now() - new Date(last.created_at).getTime()) / 60000) }, dedupeMin: 120 });
    }
    await identityDb.prepare("INSERT INTO sec_logins (account_id, country, ip, created_at) VALUES (?,?,?,?)").run(accountId, country, ip, now());
  } catch (e) { console.error("[sec] noteLogin", e?.message); }
}
export async function noteMfaFailure(accountId) {
  try { await recordEvent("mfa_fail", accountId); const n = await countEvents("mfa_fail", accountId, 10 * 60000); const { ip } = await requestInfo();
    if (n >= 5) await raiseAlert({ type: "mfa_fatigue", subject: accountId, accountId, ip, subjectKind: "account", detail: { wrongCodesIn10Min: n } }); } catch {}
}
export async function noteRateLimit(action, key) {
  try { const { ip } = await requestInfo(); const k = ip || String(key); await recordEvent("rl_breach", k); const n = await countEvents("rl_breach", k, 10 * 60000);
    if (n >= 10) await raiseAlert({ type: "rate_limit_breach", subject: k, ip, subjectKind: "ip", detail: { breachesIn10Min: n, lastAction: action } }); } catch {}
}
export async function noteDownload(accountId, label = "export") {
  try { await recordEvent("download", accountId); const n = await countEvents("download", accountId, 10 * 60000); const { ip } = await requestInfo();
    if (n >= 6) await raiseAlert({ type: "mass_download", subject: accountId, accountId, ip, subjectKind: "account", detail: { downloadsIn10Min: n, last: label } }); } catch {}
}
export async function noteDenied(staff, perm) {
  try { await recordEvent("denied", staff.id); const n = await countEvents("denied", staff.id, 10 * 60000); const { ip } = await requestInfo();
    await raiseAlert({ type: "policy_deviation", subject: staff.id, accountId: staff.id, ip, subjectKind: "account", detail: { attempted: perm, role: staff.role }, dedupeMin: 30 });
    if (n >= 4) await raiseAlert({ type: "privilege_escalation", subject: staff.id, accountId: staff.id, ip, subjectKind: "account", detail: { deniedAttemptsIn10Min: n, role: staff.role, last: perm } }); } catch {}
}
export async function notePrivilegeChange(staff, detail) {
  try { const { ip } = await requestInfo(); await raiseAlert({ type: "privilege_escalation", subject: `grant:${detail.target}`, accountId: staff.id, ip, subjectKind: "account", detail: { by: staff.pseudonym, ...detail }, dedupeMin: 5 }); } catch {}
}
export async function honeytokenHit({ ip, how, detail = {} }) {
  try { await raiseAlert({ type: "honeytoken_access", subject: ip || how, ip, subjectKind: "ip", detail: { how, ...detail }, dedupeMin: 60 }); } catch {}
}
export async function wafHit({ ip, rule, label, path, ua }) {
  try { await raiseAlert({ type: "waf_match", subject: ip, ip, subjectKind: "ip", detail: { rule, label, path: String(path).slice(0, 200), userAgent: String(ua).slice(0, 120) }, dedupeMin: 10 }); } catch {}
}

// ---------- ABAC (attribute-based) policies for staff actions ----------
// A policy says: for these permissions, the action is only allowed when ALL listed conditions hold.
// conditions: { hoursUtc: [startHour, endHour], countries: ["KE"], ipPrefixes: ["41.90."], roles: ["admin"] }
export async function abacCheck(staff, perm) {
  await init();
  const pols = await identityDb.prepare("SELECT * FROM sec_policies WHERE enabled = 1").all();
  if (!pols.length) return null;
  const { ip, country } = await requestInfo();
  const hour = new Date().getUTCHours();
  for (const p of pols) {
    const perms = P(p.perms, []);
    if (!perms.some((x) => x === "*" || x === perm || (x.endsWith(".*") && perm.startsWith(x.slice(0, -1))))) continue;
    const c = P(p.conditions, {});
    if (staff.role === "super_admin" && !c.appliesToSuperAdmin) continue;
    const why = [];
    if (c.hoursUtc && !(c.hoursUtc[0] <= c.hoursUtc[1] ? hour >= c.hoursUtc[0] && hour < c.hoursUtc[1] : hour >= c.hoursUtc[0] || hour < c.hoursUtc[1])) why.push(`outside allowed hours ${c.hoursUtc[0]}:00–${c.hoursUtc[1]}:00 UTC`);
    if (c.countries?.length && !(country && c.countries.includes(country))) why.push("country not allowed");
    if (c.ipPrefixes?.length && !(ip && c.ipPrefixes.some((x) => ip.startsWith(x)))) why.push("network not allowed");
    if (why.length) { noteDenied(staff, perm).catch(() => {}); return `Blocked by policy “${p.name}”: ${why.join(", ")}.`; }
  }
  return null;
}
export async function listPolicies() { await init(); return (await identityDb.prepare("SELECT * FROM sec_policies ORDER BY created_at DESC").all()).map((p) => ({ id: p.id, name: p.name, perms: P(p.perms, []), conditions: P(p.conditions, {}), enabled: !!p.enabled })); }
export async function savePolicy(staff, b) {
  await init();
  const perms = (Array.isArray(b.perms) ? b.perms : String(b.perms || "").split(",")).map((x) => x.trim()).filter(Boolean);
  if (!b.name || !perms.length) throw bad("A name and at least one permission are required.");
  const c = {};
  if (b.hoursStart !== "" && b.hoursStart != null && b.hoursEnd !== "" && b.hoursEnd != null) c.hoursUtc = [Math.max(0, Math.min(23, +b.hoursStart)), Math.max(0, Math.min(24, +b.hoursEnd))];
  const list = (v) => (Array.isArray(v) ? v : String(v || "").split(",")).map((x) => x.trim()).filter(Boolean);
  if (list(b.countries).length) c.countries = list(b.countries).map((x) => x.toUpperCase());
  if (list(b.ipPrefixes).length) c.ipPrefixes = list(b.ipPrefixes);
  if (b.appliesToSuperAdmin) c.appliesToSuperAdmin = true;
  if (!Object.keys(c).length) throw bad("Add at least one condition (hours, countries or networks).");
  await identityDb.prepare("INSERT INTO sec_policies (id,name,perms,conditions,enabled,created_by,created_at) VALUES (?,?,?,?,1,?,?)").run(crypto.randomUUID(), String(b.name).slice(0, 80), JSON.stringify(perms), JSON.stringify(c), staff.id, now());
  return { ok: true };
}
export async function deletePolicy(id) { await init(); await identityDb.prepare("DELETE FROM sec_policies WHERE id = ?").run(id); return { ok: true }; }

// ---------- JIT privileged access ----------
export async function jitGrant(staff, { accountId, role, minutes: mins, reason }) {
  await init();
  const acct = await identityDb.prepare("SELECT id, role FROM accounts WHERE id = ?").get(accountId);
  if (!acct) throw bad("No such account.", 404);
  if (acct.id === staff.id) throw bad("You can't grant yourself elevated access.", 409);
  if (!reason?.trim()) throw bad("A reason is required.");
  const { roleKeys } = await import("@/lib/admin/rbac");
  if (!(await roleKeys()).includes(role)) throw bad("That role doesn't exist.");
  if (role === "super_admin" && staff.role !== "super_admin") throw bad("Only a super admin can grant super admin access.", 403);
  const m = Math.max(5, Math.min(480, +mins || 60));
  const active = await identityDb.prepare("SELECT id FROM sec_jit WHERE account_id = ? AND status = 'active'").get(accountId);
  if (active) throw bad("This account already has an active temporary grant. Revoke it first.", 409);
  await identityDb.prepare("INSERT INTO sec_jit (id,account_id,from_role,to_role,reason,granted_by,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?)").run(crypto.randomUUID(), accountId, acct.role, role, reason.slice(0, 300), staff.id, minutes(m), now());
  await identityDb.prepare("UPDATE accounts SET role = ? WHERE id = ?").run(role, accountId); invalidateSession(accountId);
  await notePrivilegeChange(staff, { target: accountId, jit: true, role, minutes: m });
  return { ok: true };
}
async function endJit(j, status) {
  await identityDb.prepare("UPDATE accounts SET role = ? WHERE id = ? AND role = ?").run(j.from_role, j.account_id, j.to_role);
  await identityDb.prepare("UPDATE sec_jit SET status = ? WHERE id = ?").run(status, j.id); invalidateSession(j.account_id);
}
export async function jitRevoke(id) { await init(); const j = await identityDb.prepare("SELECT * FROM sec_jit WHERE id = ? AND status = 'active'").get(id); if (!j) throw bad("No active grant.", 404); await endJit(j, "revoked"); return { ok: true }; }

// ---------- recommendations (AI + built-in playbooks) ----------
const PLAYBOOKS = {
  impossible_travel: { quick: ["Ask the account holder to confirm the login", "Force password reset if they don't recognise it"], fix: [["Require MFA for logins from new countries", "admin"], ["Review VPN/proxy allowances in policy", "security"]] },
  new_device: { quick: ["No action unless it coincides with other alerts"], fix: [["Email users on new-device sign-in", "admin"]] },
  policy_deviation: { quick: ["Check the staff member's intent with their manager"], fix: [["Tighten or clarify the ABAC policy that was hit", "security"]] },
  rate_limit_breach: { quick: ["Throttle the IP", "Tarpit if it continues"], fix: [["Add per-route limits on the endpoint being hammered", "engineering"], ["Require a challenge for anonymous bulk reads", "engineering"]] },
  mass_download: { quick: ["Disable downloads for the account", "Review what was exported"], fix: [["Lower export quotas and add per-day caps", "admin"], ["Add DLP fingerprinting to exported files", "engineering"]] },
  auth_failures: { quick: ["Tarpit or block the IP", "Force password reset on targeted accounts"], fix: [["Enable breached-password checks", "engineering"], ["Offer passkeys / MFA to targeted users", "admin"]] },
  honeytoken_access: { quick: ["Block the IP now", "Preserve evidence", "Confirm the honeytoken source (who could have seen it?)"], fix: [["Rotate any real credentials stored near the decoy", "admin"], ["Find the leak path (repo, logs, backups) and close it", "security"]] },
  mfa_fatigue: { quick: ["Lock the account", "Call the staff member out-of-band"], fix: [["Move staff to number-matching / hardware keys", "admin"], ["Add lockout after repeated wrong codes", "engineering"]] },
  privilege_escalation: { quick: ["Freeze role changes", "Review the audit log for who granted what", "Revert unexpected role changes"], fix: [["Require a second approver for admin grants", "super_admin"], ["Use just-in-time grants instead of standing admin roles", "super_admin"]] },
  waf_match: { quick: ["Block the IP", "Check logs for any request that got through"], fix: [["Patch the targeted endpoint and add input validation", "engineering"], ["Add a dedicated WAF rule for this pattern", "security"]] },
  circuit_breaker: { quick: ["Review the automatic actions from the last hour", "Revert any that look wrong", "Re-enable auto mode only after tuning"], fix: [["Tune thresholds that caused the burst", "security"]] },
  drill: { quick: ["Practice: approve then revert the proposed action"], fix: [["Run drills monthly", "security"]] },
};
export async function recommendFor(incidentId, actor) {
  await init();
  const inc = await identityDb.prepare("SELECT * FROM sec_incidents WHERE id = ?").get(incidentId); if (!inc) throw bad("No such incident.", 404);
  const alerts = await identityDb.prepare("SELECT type, severity, detail, count FROM sec_alerts WHERE incident_id = ?").all(incidentId);
  const types = [...new Set(alerts.map((a) => a.type))];
  const base = { summary: `${alerts.length} alert(s): ${types.map((t) => ALERT_TYPES[t]?.label || t).join(", ")}.`, quick: [], fix: [], source: "playbook" };
  for (const t of types) { const p = PLAYBOOKS[t]; if (!p) continue; base.quick.push(...p.quick); base.fix.push(...p.fix.map(([title, owner]) => ({ title, owner }))); }
  base.quick = [...new Set(base.quick)];
  let rec = base;
  try {
    const { isAiConfigured, callModel } = await import("@/lib/ai");
    if (isAiConfigured()) {
      const facts = alerts.map((a) => ({ type: a.type, severity: a.severity, count: a.count, detail: P(a.detail) }));
      const text = await callModel({ maxTokens: 700, system: "You are a security incident responder for a social platform. Reply ONLY with JSON: {\"summary\": string, \"quick\": string[] (3-5 immediate, reversible measures), \"fix\": [{\"title\": string, \"owner\": \"admin\"|\"security\"|\"engineering\"|\"super_admin\"}] (2-4 permanent fixes)}. Be specific and cautious; never recommend actions that could cause an outage.", user: JSON.stringify({ incident: inc.title, severity: inc.severity, alerts: facts }) });
      const j = JSON.parse(text.replace(/```json|```/g, "").trim());
      if (Array.isArray(j.quick) && Array.isArray(j.fix)) rec = { summary: String(j.summary || base.summary).slice(0, 400), quick: j.quick.map(String).slice(0, 6), fix: j.fix.map((f) => ({ title: String(f.title).slice(0, 160), owner: ["admin", "security", "engineering", "super_admin"].includes(f.owner) ? f.owner : "security" })).slice(0, 5), source: "ai" };
    }
  } catch (e) { /* playbook already in place */ }
  await identityDb.prepare("UPDATE sec_incidents SET recommendation = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(rec), now(), incidentId);
  await timeline(incidentId, `Recommendations generated (${rec.source}).`, actor);
  return rec;
}
export async function createTasksFromRec(incidentId, items) {
  await init();
  for (const it of items) await identityDb.prepare("INSERT INTO sec_tasks (id,incident_id,title,detail,owner_role,created_at) VALUES (?,?,?,?,?,?)").run(crypto.randomUUID(), incidentId, String(it.title).slice(0, 200), it.detail || null, it.owner || "security", now());
  await timeline(incidentId, `${items.length} permanent-fix task(s) created.`);
}

// ---------- reads for the admin UI ----------
export async function socBundle(canPii) {
  await init(); await sweepExpired();
  const m = (ip) => (canPii ? ip : maskIp(ip));
  const alerts = (await identityDb.prepare("SELECT * FROM sec_alerts ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, created_at DESC LIMIT 200").all())
    .map((a) => ({ id: a.id, type: a.type, severity: a.severity, title: a.title, status: a.status, count: a.count, ip: m(a.ip), accountId: a.account_id, incidentId: a.incident_id, detail: P(a.detail), createdAt: a.created_at, updatedAt: a.updated_at }));
  const incidents = (await identityDb.prepare("SELECT * FROM sec_incidents ORDER BY CASE status WHEN 'resolved' THEN 1 ELSE 0 END, created_at DESC LIMIT 100").all())
    .map((i) => ({ id: i.id, title: i.title, severity: i.severity, status: i.status, summary: i.summary, owner: i.owner, recommendation: i.recommendation ? P(i.recommendation, null) : null, timeline: P(i.timeline, []), createdAt: i.created_at, resolvedAt: i.resolved_at }));
  const actions = (await identityDb.prepare("SELECT * FROM sec_actions ORDER BY created_at DESC LIMIT 150").all()).map((a) => ({ id: a.id, action: a.action, label: ACTIONS[a.action]?.label || a.action, target: a.target && ACTIONS[a.action]?.target === "ip" ? m(a.target) : a.target, mode: a.mode, status: a.status, actor: a.actor, note: a.note, alertId: a.alert_id, incidentId: a.incident_id, createdAt: a.created_at, expiresAt: a.expires_at }));
  const rules = (await identityDb.prepare("SELECT * FROM sec_rules ORDER BY created_at DESC LIMIT 100").all()).map((r) => ({ id: r.id, kind: r.kind, value: r.kind === "ip" ? m(r.value) : r.value, effect: r.effect, reason: r.reason, expiresAt: r.expires_at }));
  const tasks = await identityDb.prepare("SELECT * FROM sec_tasks ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, created_at DESC LIMIT 100").all();
  const jit = await identityDb.prepare("SELECT j.*, a.pseudonym FROM sec_jit j LEFT JOIN accounts a ON a.id = j.account_id ORDER BY j.created_at DESC LIMIT 50").all();
  const allow = await identityDb.prepare("SELECT value, note FROM sec_allowlist ORDER BY created_at DESC").all();
  const honey = (await identityDb.prepare("SELECT token, kind, note FROM sec_honeytokens").all()).map((h) => ({ kind: h.kind, note: h.note, token: canPii ? h.token : h.token.slice(0, 8) + "••••" }));
  const open = alerts.filter((a) => a.status === "open");
  return {
    settings: await getSettings(), alerts, incidents, actions, rules, tasks, allow, honey, policies: await listPolicies(),
    jit: jit.map((j) => ({ id: j.id, who: j.pseudonym || j.account_id, from: j.from_role, to: j.to_role, reason: j.reason, status: j.status, expiresAt: j.expires_at })),
    summary: { openAlerts: open.length, critical: open.filter((a) => a.severity === "critical").length, high: open.filter((a) => a.severity === "high").length, openIncidents: incidents.filter((i) => i.status !== "resolved").length, proposed: actions.filter((a) => a.status === "proposed").length, activeActions: actions.filter((a) => a.status === "applied").length, openTasks: tasks.filter((t) => t.status === "open").length },
    actionCatalog: Object.entries(ACTIONS).map(([k, v]) => ({ key: k, label: v.label, target: v.target, ttlMin: v.ttlMin, manualOnly: !!v.manualOnly })),
  };
}

// ---------- writes for the admin UI ----------
export async function alertStatus(staff, id, status) {
  await init();
  const a = await identityDb.prepare("SELECT * FROM sec_alerts WHERE id = ?").get(id); if (!a) throw bad("No such alert.", 404);
  if (!["ack", "resolved", "false_positive", "open"].includes(status)) throw bad("Bad status.");
  await identityDb.prepare("UPDATE sec_alerts SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), id);
  if (status === "false_positive") {
    // An alert that was a false alarm must not leave its containment behind.
    const acts = await identityDb.prepare("SELECT id FROM sec_actions WHERE alert_id = ? AND status IN ('applied','proposed')").all(id);
    for (const x of acts) await revertAction(x.id, staff.id);
  }
  await timeline(a.incident_id, `Alert marked ${status.replace("_", " ")}.`, staff.pseudonym);
  return { ok: true };
}
export async function incidentUpdate(staff, id, b) {
  await init();
  const inc = await identityDb.prepare("SELECT * FROM sec_incidents WHERE id = ?").get(id); if (!inc) throw bad("No such incident.", 404);
  if (b.status) {
    if (!["open", "investigating", "contained", "resolved"].includes(b.status)) throw bad("Bad status.");
    await identityDb.prepare("UPDATE sec_incidents SET status = ?, resolved_at = ?, updated_at = ? WHERE id = ?").run(b.status, b.status === "resolved" ? now() : null, now(), id);
    await timeline(id, `Status set to ${b.status}.`, staff.pseudonym);
    if (b.status === "resolved") await identityDb.prepare("UPDATE sec_alerts SET status = 'resolved', updated_at = ? WHERE incident_id = ? AND status IN ('open','ack')").run(now(), id);
  }
  if (b.note) await timeline(id, `Note: ${String(b.note).slice(0, 250)}`, staff.pseudonym);
  if (b.summary != null) await identityDb.prepare("UPDATE sec_incidents SET summary = ?, updated_at = ? WHERE id = ?").run(String(b.summary).slice(0, 1000), now(), id);
  return { ok: true };
}
export async function incidentCreate(staff, b) {
  await init();
  if (!b.title?.trim()) throw bad("A title is required.");
  const id = crypto.randomUUID();
  await identityDb.prepare("INSERT INTO sec_incidents (id,title,severity,status,summary,owner,timeline,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, b.title.slice(0, 140), ["low", "medium", "high", "critical"].includes(b.severity) ? b.severity : "medium", "open", b.summary ? String(b.summary).slice(0, 1000) : null, staff.id, "[]", now(), now());
  await timeline(id, "Incident opened manually.", staff.pseudonym);
  return { id };
}
export async function taskDone(staff, id) { await init(); await identityDb.prepare("UPDATE sec_tasks SET status='done', done_by=?, done_at=? WHERE id=?").run(staff.pseudonym, now(), id); return { ok: true }; }
export async function allowAdd(staff, value, note) {
  await init(); if (!/^[0-9a-fA-F:.]{3,45}$/.test(value || "")) throw bad("Enter an IP address.");
  await identityDb.prepare("INSERT INTO sec_allowlist (value,note,created_by,created_at) VALUES (?,?,?,?) ON CONFLICT (value) DO NOTHING").run(value, String(note || "").slice(0, 120), staff.id, now());
  await identityDb.prepare("DELETE FROM sec_rules WHERE kind = 'ip' AND value = ?").run(value); invalidateRulesCache(); return { ok: true };
}
export async function allowRemove(value) { await init(); await identityDb.prepare("DELETE FROM sec_allowlist WHERE value = ?").run(value); return { ok: true }; }
export async function setMode(staff, mode, maxAutoPerHour) {
  await init();
  if (!["off", "recommend", "auto"].includes(mode)) throw bad("Mode must be off, recommend or auto.");
  await setSetting("mode", mode);
  if (maxAutoPerHour) await setSetting("maxAutoPerHour", Math.max(1, Math.min(60, +maxAutoPerHour || 8)));
  return { ok: true };
}
export async function setFlag(key, on) { await init(); if (!["attackMode", "webauthnOnly", "emailMfa"].includes(key)) throw bad("Unknown setting."); await setSetting(key, on ? "1" : "0"); return { ok: true }; }
export async function liftFreeze() { await init(); await setSetting("freezeRoleChangesUntil", ""); return { ok: true }; }
export async function runDrill(staff) {
  const r = await raiseAlert({ type: "drill", subject: `drill:${Date.now()}`, subjectKind: "system", detail: { by: staff.pseudonym, note: "Practice alert. Nothing was changed." } });
  return r;
}
