// Live, admin-editable plan configuration.
//
// The numbers and switches in lib/tiers.js (STORY_PERKS, MESSAGING, PLANS, PLAN_COMPARISON) and in
// lib/identity/rate-limit.js (TIERED_DAILY_LIMITS) are the DEFAULTS. Staff can override any of them from
// Admin > Billing > "Plan limits". Overrides are stored in the database and applied IN PLACE onto those same
// exported objects, so every route, page and app screen that already reads them (server enforcement, plan page,
// profile plan line, native plan screen) changes together without touching a single call site. That is what
// "everything interconnected" means here: one source of truth, edited in one place.
//
// Multi-instance note: each server instance re-reads the overrides every 15 s (and immediately after a save on
// the instance that handled it), so a change reaches every instance within seconds.
import { identityDb } from "./identity/db.js";
import { PLANS, PLAN_COMPARISON, MESSAGING, STORY_PERKS } from "./tiers.js";
import { TIERED_DAILY_LIMITS } from "./identity/rate-limit.js";

export const TIERS = ["basic", "plus", "pro"];
export const TIER_LABEL = { basic: "OUT", plus: "OUT+", pro: "OUT PRO" };
const iso = () => new Date().toISOString();

const clone = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v === Infinity ? "__inf__" : v)), (k, v) => (v === "__inf__" ? Infinity : v));
let DEFAULTS = null;
function snapshotDefaults() {
  if (DEFAULTS) return;
  DEFAULTS = { tiered: clone(TIERED_DAILY_LIMITS), perks: clone(STORY_PERKS), msg: clone(MESSAGING), plans: clone(PLANS), comparison: clone(PLAN_COMPARISON) };
}

// ---- what can be edited ---------------------------------------------------------------------------------------
const MSG_LABELS = {
  requestsPerDay: ["Message requests per day", "int"], messagesPerDay: ["Messages per day", "int"], maxLen: ["Max message length (chars)", "int"],
  requestMaxLen: ["Max request length (chars)", "int"], outsideNetwork: ["Message people outside network", "bool"], priority: ["Priority messages", "bool"],
  analytics: ["Message analytics", "bool"], aiOutreach: ["AI-assisted outreach", "bool"], stickers: ["Stickers and GIFs", "bool"],
  voiceNotes: ["Voice notes", "bool"], voiceNoteMaxSeconds: ["Voice note max length (seconds)", "int"], fileSharing: ["File sharing", "bool"], fileMaxMB: ["File size limit (MB)", "int"],
};
const PERK_LABELS = {
  aliases: "Aliases", trackedStories: "Tracked stories", savedSearches: "Saved searches", circlesCreate: "Circles you can start", circleMembersMax: "Circle members (max)",
  exports: "Exports", aiStoryAssistant: "AI Story Assistant", identityRisk: "Identity-risk warnings", summaries: "AI summaries", companyIntel: "Company intel",
  deepDive: "Company Deep Dive", patternExplorer: "Pattern Explorer", scheduledPublishing: "Scheduled publishing", creatorAnalytics: "Creator analytics", hostRooms: "Host Story Rooms",
};

export function catalog() {
  snapshotDefaults();
  const items = [];
  for (const [name, rule] of Object.entries(DEFAULTS.tiered)) items.push({ kind: "tiered", name, label: `${rule.label} (per day)`, type: "int", group: "Daily limits" });
  for (const [name, [label, type]] of Object.entries(MSG_LABELS)) items.push({ kind: "msg", name, label, type, group: "Messaging" });
  for (const [name, label] of Object.entries(PERK_LABELS)) items.push({ kind: "perk", name, label, type: typeof DEFAULTS.perks.basic[name] === "boolean" ? "bool" : "int", group: "Story & community" });
  return items;
}
const live = (kind, name, tier) => (kind === "tiered" ? TIERED_DAILY_LIMITS[name]?.[tier] : kind === "msg" ? MESSAGING[tier]?.[name] : STORY_PERKS[tier]?.[name]);
const dflt = (kind, name, tier) => (kind === "tiered" ? DEFAULTS.tiered[name]?.[tier] : kind === "msg" ? DEFAULTS.msg[tier]?.[name] : DEFAULTS.perks[tier]?.[name]);

export function fmtValue(v, type) {
  if (type === "bool") return v ? "On" : "Off";
  if (v === Infinity) return "Unlimited";
  if (v === 0) return "Not allowed";
  return String(v);
}
export function parseValue(raw, type) {
  const t = String(raw ?? "").trim().toLowerCase();
  if (type === "bool") {
    if (["on", "yes", "true", "1", "enabled", "allow", "allowed"].includes(t)) return true;
    if (["off", "no", "false", "0", "disabled", "none"].includes(t)) return false;
    throw Object.assign(new Error("Type on or off."), { status: 400 });
  }
  if (["unlimited", "infinite", "no limit", "∞"].includes(t)) return Infinity;
  if (["off", "none", "not allowed"].includes(t)) return 0;
  const n = Math.round(Number(t));
  if (!Number.isFinite(n) || n < 0 || n > 1e9) throw Object.assign(new Error("Enter a whole number (0 = not allowed), or type unlimited."), { status: 400 });
  return n;
}

// ---- persistence ----------------------------------------------------------------------------------------------
let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  await identityDb.prepare("CREATE TABLE IF NOT EXISTS plan_overrides (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT, updated_at TEXT NOT NULL)").run();
  tableReady = true;
}
let overrides = {}; let lastLoad = 0; let loading = null;

function applyAll() {
  snapshotDefaults();
  // 1. back to defaults, 2. apply every override on top.
  for (const [n, r] of Object.entries(DEFAULTS.tiered)) for (const t of TIERS) TIERED_DAILY_LIMITS[n][t] = r[t];
  for (const t of TIERS) { Object.assign(STORY_PERKS[t], DEFAULTS.perks[t]); Object.assign(MESSAGING[t], DEFAULTS.msg[t]); Object.assign(PLANS[t], DEFAULTS.plans[t]); }
  for (const [key, raw] of Object.entries(overrides)) {
    const [kind, name, tier] = key.split(":");
    if (!TIERS.includes(tier)) continue;
    const v = raw === "__inf__" ? Infinity : raw;
    if (kind === "tiered" && TIERED_DAILY_LIMITS[name]) TIERED_DAILY_LIMITS[name][tier] = v;
    else if (kind === "msg" && name in MESSAGING[tier]) MESSAGING[tier][name] = v;
    else if (kind === "perk" && name in STORY_PERKS[tier]) STORY_PERKS[tier][name] = v;
    else if (kind === "price" && PLANS[tier] && name in PLANS[tier]) PLANS[tier][name] = v;
  }
  for (const t of ["plus", "pro"]) PLANS[t].annualMonthly = Math.round((PLANS[t].annual / 12) * 100) / 100; // keep "per month billed yearly" honest after an edit
  // The plan comparison the user sees follows the live switches for every on/off row.
  PLAN_COMPARISON.forEach((sec, si) => sec.rows.forEach((row, ri) => {
    const base = DEFAULTS.comparison[si]?.rows[ri];
    if (!base) return;
    if (base.bool && base.backend) { const [kind, name] = base.backend.split(":"); row.values = TIERS.map((t) => !!live(kind, name, t)); }
    else if (base.backend?.startsWith("perk:") || base.backend?.startsWith("tiered:") || base.backend?.startsWith("msg:")) {
      // Level rows (Light / Extended / Highest): recompute from the live number, so "not allowed" shows as not included.
      const [kind, name] = base.backend.split(":");
      row.values = base.values.map((bv, i) => {
        const v = live(kind, name, TIERS[i]);
        if (v === 0 || v === false) return false;
        return bv === false ? "Light" : bv;
      });
    }
  }));
}

export async function refreshPlanConfig(force = false) {
  if (!force && Date.now() - lastLoad < 15000) return;
  if (loading) return loading;
  lastLoad = Date.now();
  loading = (async () => {
    try {
      await ensureTable();
      const rows = await identityDb.prepare("SELECT key, value FROM plan_overrides").all();
      const next = {};
      for (const r of rows) { try { next[r.key] = JSON.parse(r.value); } catch { /* ignore a corrupt row */ } }
      overrides = next; applyAll();
    } catch (e) { console.error("[plan-config] refresh failed:", e.message); }
    finally { loading = null; }
  })();
  return loading;
}

export async function setOverride(staff, key, value) {
  await ensureTable();
  const v = value === Infinity ? "__inf__" : value;
  await identityDb.prepare("INSERT INTO plan_overrides (key, value, updated_by, updated_at) VALUES (?,?,?,?) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=EXCLUDED.updated_at")
    .run(key, JSON.stringify(v), staff.id, iso());
  await refreshPlanConfig(true);
}
export async function clearOverride(key) {
  await ensureTable();
  await identityDb.prepare("DELETE FROM plan_overrides WHERE key = ?").run(key);
  await refreshPlanConfig(true);
}
export const hasOverride = (key) => key in overrides;

// Rows for the admin table.
export async function planRows() {
  await refreshPlanConfig(true);
  const rows = [];
  for (const it of catalog()) for (const t of TIERS) {
    const key = `${it.kind}:${it.name}:${t}`;
    const v = live(it.kind, it.name, t), d = dflt(it.kind, it.name, t);
    rows.push({ id: key, group: it.group, feature: it.label, plan: TIER_LABEL[t], value: fmtValue(v, it.type), default: fmtValue(d, it.type), state: hasOverride(key) ? "changed" : "default", _type: it.type });
  }
  for (const t of ["plus", "pro"]) for (const f of ["monthly", "annual"]) {
    const key = `price:${f}:${t}`;
    rows.push({ id: key, group: "Prices (display)", feature: `${f === "monthly" ? "Monthly" : "Yearly"} price (USD)`, plan: TIER_LABEL[t], value: "$" + PLANS[t][f], default: "$" + DEFAULTS.plans[t][f], state: hasOverride(key) ? "changed" : "default", _type: "price" });
  }
  return rows;
}
export function parseForKey(key, raw) {
  const [kind, name] = key.split(":");
  if (kind === "price") { const n = Number(String(raw).replace("$", "")); if (!(n >= 0 && n < 100000)) throw Object.assign(new Error("Enter a price in dollars, e.g. 14.99."), { status: 400 }); return Math.round(n * 100) / 100; }
  const it = catalog().find((c) => c.kind === kind && c.name === name);
  if (!it) throw Object.assign(new Error("Unknown setting."), { status: 400 });
  return parseValue(raw, it.type);
}
