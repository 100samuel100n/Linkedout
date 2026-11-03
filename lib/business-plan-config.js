// Live, admin-editable BUSINESS plan configuration (companies: Business, Business Pro, Enterprise). Same idea as lib/plan-config.js for OUT / OUT+ / OUT PRO:
// the constants in lib/business-features.js and lib/tiers.js are the DEFAULTS; staff overrides are stored in the database and applied IN PLACE onto
// those same exported objects, so the server (has() / levelOf()), the pre-purchase comparison table and the company dashboard all change together.
// Editable: every feature's level per plan, seats, job slots, alert rules, and the displayed prices (charged amounts always come from your Stripe prices).
import { identityDb } from "./identity/db.js";
import { FEATURES, SEATS, JOBS_MAX, ALERT_RULES_MAX, PLAN_KEYS, PLAN_LABELS, PILLARS } from "./business-features.js";
import { BUSINESS_PLANS } from "./tiers.js";

const clone = (o) => JSON.parse(JSON.stringify(o));
let DEF = null;
const snap = () => { if (!DEF) DEF = { levels: Object.fromEntries(Object.entries(FEATURES).map(([k, f]) => [k, clone(f.levels)])), seats: clone(SEATS), jobs: clone(JOBS_MAX), alerts: clone(ALERT_RULES_MAX), prices: clone(BUSINESS_PLANS) }; };
const iso = () => new Date().toISOString();
const PROTECTED = new Set(["verified_page"]);          // the free verified page is the base of the product: it can't be switched off for anyone

export const fmt = (v) => (v === true ? "On" : v === false ? "Off" : v === null || v === undefined ? "n/a" : String(v));
export function parseFeature(raw) {
  const t = String(raw ?? "").trim().toLowerCase();
  if (["on", "yes", "true", "included"].includes(t)) return true;
  if (["off", "no", "false", "none"].includes(t)) return false;
  if (["basic", "advanced", "custom", "public"].includes(t)) return t;
  const n = Math.round(Number(t)); if (Number.isFinite(n) && n >= 0 && n <= 1e6 && /^\d+$/.test(t)) return n;
  throw Object.assign(new Error("Type on, off, basic, advanced, custom, public, or a whole number."), { status: 400 });
}
const parseInt0 = (raw, max = 1e6) => { const n = Math.round(Number(String(raw).trim())); if (!Number.isFinite(n) || n < 0 || n > max || !/^\d+$/.test(String(raw).trim())) throw Object.assign(new Error(`Enter a whole number from 0 to ${max}.`), { status: 400 }); return n; };
const parsePrice = (raw) => { const n = Number(String(raw).replace(/[$,\s]/g, "")); if (!(n >= 0 && n <= 1e6)) throw Object.assign(new Error("Enter an amount such as 199 or 2101.44."), { status: 400 }); return Math.round(n * 100) / 100; };

// ---------------------------------------------------------------- catalogue of editable rows
export function catalog() {
  snap(); const rows = [];
  for (const [key, f] of Object.entries(FEATURES)) for (let i = 0; i < PLAN_KEYS.length; i++) rows.push({ id: `feat:${key}:${PLAN_KEYS[i]}`, group: PILLARS.find((p) => p.key === f.pillar)?.label || f.pillar, label: f.label + (f.status === "soon" ? " (roadmap)" : ""), plan: PLAN_KEYS[i], live: FEATURES[key].levels[i], def: DEF.levels[key][i], parse: parseFeature });
  for (const p of PLAN_KEYS) {
    rows.push({ id: `seats:${p}`, group: "Limits", label: "Team seats (including owner)", plan: p, live: SEATS[p], def: DEF.seats[p], parse: parseInt0 });
    rows.push({ id: `jobs:${p}`, group: "Limits", label: "Job slots", plan: p, live: JOBS_MAX[p], def: DEF.jobs[p], parse: parseInt0 });
    rows.push({ id: `alerts:${p}`, group: "Limits", label: "Alert rules", plan: p, live: ALERT_RULES_MAX[p], def: DEF.alerts[p], parse: parseInt0 });
  }
  for (const p of ["business", "business_pro"]) for (const k of ["monthly", "annual"]) rows.push({ id: `price:${p}:${k}`, group: "Prices (display)", label: `${k === "monthly" ? "Monthly" : "Yearly"} price (USD)`, plan: p, live: BUSINESS_PLANS[p][k], def: DEF.prices[p][k], parse: parsePrice });
  return rows;
}

// ---------------------------------------------------------------- persistence + in-place application
let ready = false, overrides = {}, last = 0, loading = null;
async function ensure() { if (ready) return; await identityDb.prepare("CREATE TABLE IF NOT EXISTS business_plan_overrides (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT, updated_at TEXT NOT NULL)").run(); ready = true; }
function apply() {
  snap();
  for (const [k, f] of Object.entries(FEATURES)) f.levels.splice(0, f.levels.length, ...DEF.levels[k]);
  for (const p of PLAN_KEYS) { SEATS[p] = DEF.seats[p]; JOBS_MAX[p] = DEF.jobs[p]; ALERT_RULES_MAX[p] = DEF.alerts[p]; }
  for (const p of ["business", "business_pro"]) { BUSINESS_PLANS[p].monthly = DEF.prices[p].monthly; BUSINESS_PLANS[p].annual = DEF.prices[p].annual; }
  for (const [key, v] of Object.entries(overrides)) {
    const [kind, a, b] = key.split(":");
    if (kind === "feat" && FEATURES[a] && PLAN_KEYS.includes(b)) FEATURES[a].levels[PLAN_KEYS.indexOf(b)] = v;
    else if (kind === "seats" && PLAN_KEYS.includes(a)) SEATS[a] = v; else if (kind === "jobs" && PLAN_KEYS.includes(a)) JOBS_MAX[a] = v; else if (kind === "alerts" && PLAN_KEYS.includes(a)) ALERT_RULES_MAX[a] = v;
    else if (kind === "price" && BUSINESS_PLANS[a] && (b === "monthly" || b === "annual")) BUSINESS_PLANS[a][b] = v;
  }
  for (const p of ["business", "business_pro"]) BUSINESS_PLANS[p].annualMonthly = Math.round((BUSINESS_PLANS[p].annual / 12) * 100) / 100;
}
export async function refreshBusinessConfig(force = false) {
  if (!force && Date.now() - last < 15000) return; if (loading) return loading; last = Date.now();
  loading = (async () => { try { await ensure(); const rows = await identityDb.prepare("SELECT key, value FROM business_plan_overrides").all(); const next = {}; for (const r of rows) { try { next[r.key] = JSON.parse(r.value); } catch { /* skip corrupt row */ } } overrides = next; apply(); } catch (e) { console.error("[business-plan-config]", e.message); } finally { loading = null; } })();
  return loading;
}
export async function setBusinessOverride(staff, id, raw) {
  const row = catalog().find((r) => r.id === id); if (!row) throw Object.assign(new Error("Unknown setting."), { status: 404 });
  const value = row.parse(raw);
  if (id.startsWith("feat:")) { const key = id.split(":")[1]; if (PROTECTED.has(key) && !value) throw Object.assign(new Error("The verified company page can't be switched off."), { status: 400 }); }
  if (id.startsWith("seats:") && value < 1) throw Object.assign(new Error("A plan needs at least 1 seat (the owner)."), { status: 400 });
  await ensure(); await identityDb.prepare("INSERT INTO business_plan_overrides (key, value, updated_by, updated_at) VALUES (?,?,?,?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at").run(id, JSON.stringify(value), staff.id, iso());
  await refreshBusinessConfig(true); return value;
}
export async function clearBusinessOverride(id) { await ensure(); await identityDb.prepare("DELETE FROM business_plan_overrides WHERE key = ?").run(id); await refreshBusinessConfig(true); }
export { PLAN_KEYS, PLAN_LABELS };