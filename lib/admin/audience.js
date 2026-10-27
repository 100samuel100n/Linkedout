// Who a broadcast goes to. One resolver for BOTH channels (push + email) so the
// audience builder behaves identically. Everything is parameterised SQL.
//
// audience = {
//   mode: "all" | "segment" | "individuals",
//   // segment filters (all combined with AND):
//   plans: ["basic","plus","pro"], countries: ["KE","US"], staffOnly: bool,
//   verified: ["id","email","phone"],          // must have ALL of these
//   activeDays: n,    // seen within the last n days
//   inactiveDays: n,  // NOT seen for n days (win-back)
//   joinedDays: n,    // signed up within the last n days
//   hasOpenTicket: bool, twoFactor: "" | "yes" | "no",
//   // individuals: pasted handles / emails / account ids, separated by commas, spaces or new lines
//   people: "maya_okafor, dev@mail.com"
// }
import { identityDb } from "@/lib/identity/db";

const iso = (d) => new Date(Date.now() - d * 864e5).toISOString();
const list = (v) => (Array.isArray(v) ? v : String(v || "").split(/[,\s]+/)).map((x) => String(x).trim()).filter(Boolean);

export function normalizeAudience(a = {}) {
  const mode = ["all", "segment", "individuals"].includes(a.mode) ? a.mode : "all";
  const n = (v) => { const x = Math.round(Number(v)); return x > 0 && x <= 3650 ? x : null; };
  return {
    mode,
    plans: list(a.plans).filter((p) => ["basic", "plus", "pro"].includes(p)),
    countries: list(a.countries).map((c) => c.toUpperCase()).slice(0, 60),
    staffOnly: !!a.staffOnly,
    verified: list(a.verified).filter((v) => ["id", "email", "phone"].includes(v)),
    activeDays: n(a.activeDays), inactiveDays: n(a.inactiveDays), joinedDays: n(a.joinedDays),
    hasOpenTicket: !!a.hasOpenTicket, twoFactor: ["yes", "no"].includes(a.twoFactor) ? a.twoFactor : "",
    people: mode === "individuals" ? String(a.people || "").slice(0, 20000) : "",
  };
}

export function describeAudience(a) {
  a = normalizeAudience(a);
  if (a.mode === "all") return "Everyone";
  if (a.mode === "individuals") return `${list(a.people).length} specific ${list(a.people).length === 1 ? "person" : "people"}`;
  const p = [];
  if (a.plans.length) p.push(a.plans.map((x) => (x === "basic" ? "Free" : x[0].toUpperCase() + x.slice(1))).join("/") + " plan");
  if (a.countries.length) p.push(a.countries.join(", "));
  if (a.staffOnly) p.push("staff");
  if (a.verified.length) p.push("verified " + a.verified.join("+"));
  if (a.activeDays) p.push(`active ≤${a.activeDays}d`); if (a.inactiveDays) p.push(`inactive ≥${a.inactiveDays}d`); if (a.joinedDays) p.push(`joined ≤${a.joinedDays}d`);
  if (a.hasOpenTicket) p.push("open support ticket"); if (a.twoFactor) p.push(`2FA ${a.twoFactor}`);
  return p.length ? p.join(" · ") : "Everyone";
}

function where(a, { channel, kind, withChannel }) {
  const c = ["COALESCE(a.deactivated, 0) = 0", "a.status <> 'banned'"], p = [];
  if (a.mode === "individuals") {
    const items = list(a.people).map((x) => x.toLowerCase());
    c.push("(lower(a.email) = ANY(?) OR lower(a.pseudonym) = ANY(?) OR a.id = ANY(?))");
    p.push(items, items, list(a.people));
  } else if (a.mode === "segment") {
    if (a.plans.length) { c.push("a.premium_tier = ANY(?)"); p.push(a.plans); }
    if (a.countries.length) { c.push("upper(a.country) = ANY(?)"); p.push(a.countries); }
    if (a.staffOnly) c.push("a.role <> 'user'");
    if (a.verified.includes("id")) c.push("a.government_id_status = 'verified'");
    if (a.verified.includes("email")) c.push("a.email_verified = 1");
    if (a.verified.includes("phone")) c.push("a.phone_verified = 1");
    if (a.activeDays) { c.push("a.last_seen_at >= ?"); p.push(iso(a.activeDays)); }
    if (a.inactiveDays) { c.push("(a.last_seen_at IS NULL OR a.last_seen_at < ?)"); p.push(iso(a.inactiveDays)); }
    if (a.joinedDays) { c.push("a.created_at >= ?"); p.push(iso(a.joinedDays)); }
    if (a.hasOpenTicket) c.push("EXISTS (SELECT 1 FROM support_tickets t WHERE t.account_id = a.id AND t.status IN ('open','pending'))");
    if (a.twoFactor === "yes") c.push("a.totp_enabled = 1"); if (a.twoFactor === "no") c.push("COALESCE(a.totp_enabled, 0) = 0");
  }
  if (withChannel) {
    if (channel === "push") c.push("EXISTS (SELECT 1 FROM push_tokens t WHERE t.account_id = a.id)");
    if (channel === "email") { c.push("a.email IS NOT NULL AND a.email <> ''"); if (a.mode !== "individuals") c.push("a.email_verified = 1"); }
    // Marketing/announcement sends honour the person's "Announcements & offers" switch;
    // service notices (outages, security, legal) deliberately don't.
    if (kind !== "service") c.push(`NOT EXISTS (SELECT 1 FROM notification_preferences np WHERE np.account_id = a.id AND np.category = 'announcements' AND np.${channel === "push" ? "push" : "email"} = 0)`);
  }
  return { sql: c.join(" AND "), params: p };
}

export async function previewAudience(channel, audience, kind = "marketing") {
  const a = normalizeAudience(audience);
  const m = where(a, { channel, kind, withChannel: false }), r = where(a, { channel, kind, withChannel: true });
  const [matched, reachable, sample] = await Promise.all([
    identityDb.prepare(`SELECT COUNT(*) AS n FROM accounts a WHERE ${m.sql}`).get(...m.params),
    identityDb.prepare(`SELECT COUNT(*) AS n FROM accounts a WHERE ${r.sql}`).get(...r.params),
    identityDb.prepare(`SELECT a.pseudonym FROM accounts a WHERE ${r.sql} ORDER BY a.created_at DESC LIMIT 5`).all(...r.params),
  ]);
  return { matched: Number(matched.n), reachable: Number(reachable.n), sample: sample.map((s) => s.pseudonym), label: describeAudience(a) };
}

export async function resolveRecipients(channel, audience, kind = "marketing", limit = 250000) {
  const a = normalizeAudience(audience), w = where(a, { channel, kind, withChannel: true });
  return identityDb.prepare(`SELECT a.id, a.email, a.pseudonym, a.real_name FROM accounts a WHERE ${w.sql} ORDER BY a.created_at LIMIT ${Math.min(limit, 250000)}`).all(...w.params);
}
