// Data access for the admin dashboard. Everything here is real SQL against
// the existing identity/content stores — there is no mock data. Each
// section exposes LIST (what to show) and ACT (what staff can do to a row);
// the generic web/native UIs render whatever these return.
import { identityDb } from "@/lib/identity/db";
import { contentDb } from "@/lib/content/db";
import { getVerificationDocumentSignedUrl } from "@/lib/identity/documents";
import { reviewVerificationRequest } from "@/lib/identity/service";
import { can } from "./roles";
import { applyEnforcement, logStaff, accountIdForAnonymousId } from "./enforce";
import * as SYS from "./systems";

const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const uid = () => crypto.randomUUID();
const safe = async (fn, fb = 0) => { try { return await fn(); } catch { return fb; } };
const n = async (db, sql, ...p) => Number((await db.prepare(sql).get(...p))?.n ?? 0);
const cut = (s, k = 90) => (s && s.length > k ? s.slice(0, k) + "…" : s || "");
const day0 = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString(); };
import { PLANS } from "@/lib/tiers";
const PRICE = { plus: PLANS.plus.monthly, pro: PLANS.pro.monthly }; // single source: lib/tiers.js
const bad = (m, status = 400) => Object.assign(new Error(m), { status });

// ---------------- Command Center ----------------
async function perMinute(db, table, minutes = 30, where = "") {
  const rows = await db.prepare(`SELECT substr(created_at,1,16) AS m, COUNT(*) AS c FROM ${table} WHERE created_at >= ? ${where} GROUP BY m`).all(iso(minutes * 60000));
  const map = new Map(rows.map((r) => [r.m, Number(r.c)]));
  return Array.from({ length: minutes }, (_, i) => map.get(iso((minutes - 1 - i) * 60000).slice(0, 16)) || 0);
}

async function badgesLite() { return (await import("./systems")).badges(); }

export async function overview() {
  const t0 = Date.now();
  const I = identityDb, C = contentDb, today = day0(), wk = iso(7 * 864e5);
  const [total, newToday, newWeek, dau, mau, online, suspended, restricted, locked, appealsPending, verifPending, billing] = await Promise.all([
    safe(() => n(I, "SELECT COUNT(*) AS n FROM accounts")),
    safe(() => n(I, "SELECT COUNT(*) AS n FROM accounts WHERE created_at >= ?", today)),
    safe(() => n(I, "SELECT COUNT(*) AS n FROM accounts WHERE created_at >= ?", wk)),
    safe(() => n(I, "SELECT COUNT(*) AS n FROM daily_active WHERE day = ?", today.slice(0, 10))),
    safe(() => n(I, "SELECT COUNT(DISTINCT account_id) AS n FROM daily_active WHERE day >= ?", iso(29 * 864e5).slice(0, 10))),
    safe(() => n(I, "SELECT COUNT(*) AS n FROM accounts WHERE last_seen_at >= ?", iso(5 * 60000))),
    safe(() => n(I, "SELECT COUNT(*) AS n FROM accounts WHERE status IN ('suspended','banned')")),
    safe(() => n(I, "SELECT COUNT(*) AS n FROM accounts WHERE restrictions <> '[]'")),
    safe(() => n(I, "SELECT COUNT(*) AS n FROM accounts WHERE status = 'locked'")),
    safe(() => n(I, "SELECT COUNT(*) AS n FROM appeals WHERE status = 'pending'")),
    safe(() => n(I, "SELECT COUNT(*) AS n FROM verification_requests WHERE status = 'pending'")),
    safe(() => I.prepare("SELECT premium_tier AS t, COUNT(*) AS n FROM accounts WHERE premium_tier <> 'basic' GROUP BY premium_tier").all(), []),
  ]);
  const [postsToday, repostsToday, commentsToday, reactionsToday, likesToday, mediaToday, removed, reportsToday, reportsPending, dmReportsOpen, disputesOpen, msgsToday, spamReports] = await Promise.all([
    safe(() => n(C, "SELECT COUNT(*) AS n FROM posts WHERE repost_of IS NULL AND created_at >= ?", today)),
    safe(() => n(C, "SELECT COUNT(*) AS n FROM posts WHERE repost_of IS NOT NULL AND created_at >= ?", today)),
    safe(() => n(C, "SELECT COUNT(*) AS n FROM comments WHERE created_at >= ?", today)),
    safe(() => n(C, "SELECT COUNT(*) AS n FROM reactions WHERE created_at >= ?", today)),
    safe(() => n(C, "SELECT COUNT(*) AS n FROM likes WHERE created_at >= ?", today)),
    safe(() => n(C, "SELECT COUNT(*) AS n FROM posts WHERE media_path IS NOT NULL AND created_at >= ?", today)),
    safe(() => n(C, "SELECT COUNT(*) AS n FROM posts WHERE visibility = 'removed'")),
    safe(() => n(C, "SELECT COUNT(*) AS n FROM content_reports WHERE created_at >= ?", today)),
    safe(() => n(C, "SELECT COUNT(*) AS n FROM content_reports WHERE status = 'open'")),
    safe(() => n(C, "SELECT COUNT(*) AS n FROM dm_reports WHERE status = 'open'")),
    safe(() => n(C, "SELECT COUNT(*) AS n FROM company_disputes WHERE status = 'open'")),
    safe(() => n(C, "SELECT COUNT(*) AS n FROM dm_messages WHERE created_at >= ?", today)),
    safe(() => n(C, "SELECT COUNT(*) AS n FROM content_reports WHERE reason ILIKE '%spam%' AND status = 'open'")),
  ]);
  const [sPosts, sReposts, sLikes, sComments, sReact] = await Promise.all([
    safe(() => perMinute(C, "posts", 30, "AND repost_of IS NULL"), []), safe(() => perMinute(C, "posts", 30, "AND repost_of IS NOT NULL"), []),
    safe(() => perMinute(C, "likes"), []), safe(() => perMinute(C, "comments"), []), safe(() => perMinute(C, "reactions"), []),
  ]);
  const [att, recent, signups14, dau14] = await Promise.all([
    badgesLite(),
    safe(() => identityDb.prepare("SELECT l.action, l.actor_role, l.target, l.created_at, a.pseudonym FROM staff_audit_log l LEFT JOIN accounts a ON a.id = l.actor_id ORDER BY l.created_at DESC LIMIT 8").all(), []),
    safe(() => identityDb.prepare("SELECT substr(created_at,1,10) d, COUNT(*) c FROM accounts WHERE created_at >= ? GROUP BY d").all(iso(14 * 864e5)), []),
    safe(() => identityDb.prepare("SELECT day d, COUNT(*) c FROM daily_active WHERE day >= ? GROUP BY day").all(iso(14 * 864e5).slice(0, 10)), []),
  ]);
  const days14 = Array.from({ length: 14 }, (_, i) => iso((13 - i) * 864e5).slice(0, 10));
  const m14 = (rows) => { const m = new Map(rows.map((r) => [r.d, Number(r.c)])); return days14.map((d) => m.get(d) || 0); }
  const mrr = billing.reduce((s, r) => s + (PRICE[r.t] || 0) * Number(r.n), 0);
  const dbLatency = Date.now() - t0;
  const sq = (db, sql, ...p) => safe(() => n(db, sql, ...p));
  const [storiesToday, storiesTotal, storyReportsOpen, employmentPending, circlesCount, meTooToday, businessActive] = await Promise.all([
    sq(contentDb, "SELECT COUNT(*) AS n FROM stories WHERE status='published' AND created_at >= ?", day0()),
    sq(contentDb, "SELECT COUNT(*) AS n FROM stories WHERE status='published'"),
    sq(contentDb, "SELECT COUNT(*) AS n FROM story_disputes WHERE status='open'"),
    sq(identityDb, "SELECT COUNT(*) AS n FROM employment_verifications WHERE method='document' AND status='pending'"),
    sq(contentDb, "SELECT COUNT(*) AS n FROM circles WHERE status='active'"),
    sq(contentDb, "SELECT COUNT(*) AS n FROM story_me_too WHERE created_at >= ?", day0()),
    sq(contentDb, "SELECT COUNT(*) AS n FROM company_plans WHERE status='active'"),
  ]);
  return {
    at: iso(),
    kpis: {
      totalUsers: total, dau, mau, onlineNow: online, newToday, newWeek,
      postsToday, repostsToday, commentsToday, reactionsToday, likesToday, messagesToday: msgsToday, mediaToday,
      reportsToday, reportsPending: reportsPending + dmReportsOpen + disputesOpen, appealsPending, verificationPending: verifPending,
      suspended, restricted, locked, contentRemoved: removed, spamFlagged: spamReports,
      subscribers: billing.reduce((s, r) => s + Number(r.n), 0), mrrEstimate: Math.round(mrr * 100) / 100,
      storiesToday, storiesTotal, storyReportsOpen, employmentPending, circlesCount, meTooToday, businessPlansActive: businessActive,
    },
    series: { posts: sPosts, reposts: sReposts, likes: sLikes, replies: sComments, reactions: sReact },
    attention: att,
    recent: recent.map((r) => ({ who: r.pseudonym || "staff", role: r.actor_role, action: r.action, target: r.target ? String(r.target).slice(0, 10) : "", at: r.created_at })),
    trends: { days: days14, signups: m14(signups14), dau: m14(dau14) },
    health: { dbLatencyMs: dbLatency, uptimeSec: Math.round(process.uptime()), status: dbLatency < 1500 ? "healthy" : "degraded" },
  };
}

// ---------------- Users ----------------
export async function listUsers(staff, { q = "", status = "", limit = 50 } = {}) {
  const pii = can(staff.role, "users.pii");
  const like = `%${q.trim()}%`;
  const rows = await identityDb.prepare(
    `SELECT id, pseudonym, email, real_name, status, role, premium_tier, email_verified, phone_verified, government_id_status, restrictions, created_at, last_seen_at
     FROM accounts WHERE (? = '' OR pseudonym ILIKE ? OR id = ? ${pii ? "OR email ILIKE ? OR real_name ILIKE ?" : ""})
     AND (? = '' OR status = ?) ORDER BY created_at DESC LIMIT ?`
  ).all(...[q.trim(), like, q.trim(), ...(pii ? [like, like] : []), status, status, Math.min(+limit || 50, 200)]);
  const { onlineIds } = await import("./presence.js");
  const online = await onlineIds(rows.map((r) => r.id));
  return rows.map((r) => ({
    online: online.has(r.id),
    id: r.id, pseudonym: r.pseudonym, status: r.status, role: r.role, tier: r.premium_tier,
    emailVerified: !!r.email_verified, phoneVerified: !!r.phone_verified, idStatus: r.government_id_status,
    restrictions: JSON.parse(r.restrictions || "[]"), createdAt: r.created_at, lastSeenAt: r.last_seen_at,
    ...(pii ? { email: r.email, realName: r.real_name } : {}),
  }));
}

export async function userDetail(staff, id) {
  const pii = can(staff.role, "users.pii");
  const a = await identityDb.prepare("SELECT * FROM accounts WHERE id = ?").get(id);
  if (!a) throw bad("No such user.", 404);
  const anon = await identityDb.prepare("SELECT anonymous_id FROM anonymous_identities WHERE account_id = ?").all(id);
  const ids = anon.map((x) => x.anonymous_id);
  const enforcements = await identityDb.prepare("SELECT id, action, reason, issued_by, expires_at, revoked_at, created_at FROM enforcements WHERE account_id = ? ORDER BY created_at DESC").all(id);
  const posts = ids.length ? await safe(() => n(contentDb, "SELECT COUNT(*) AS n FROM posts WHERE anonymous_id = ANY(?)", ids)) : 0;
  const openReports = ids.length ? await safe(() => n(contentDb, "SELECT COUNT(*) AS n FROM content_reports r JOIN posts p ON p.id = r.target_id WHERE r.target_type='post' AND r.status='open' AND p.anonymous_id = ANY(?)", ids)) : 0;
  const followers = await safe(() => n(identityDb, "SELECT COUNT(*) AS n FROM follows WHERE followed_handle = ?", a.pseudonym));
  await logStaff(staff, "view_user", id);
  return {
    id: a.id, pseudonym: a.pseudonym, bio: a.bio, status: a.status, statusUntil: a.status_until, role: a.role, label: a.account_label,
    tier: a.premium_tier, subscriptionStatus: a.subscription_status, emailVerified: !!a.email_verified, phoneVerified: !!a.phone_verified,
    idStatus: a.government_id_status, businessStatus: a.business_verified_status, professionalStatus: a.professional_verified_status,
    country: a.country, accountType: a.account_type, restrictions: JSON.parse(a.restrictions || "[]"), mustResetPassword: !!a.must_reset_password,
    createdAt: a.created_at, lastSeenAt: a.last_seen_at, deactivated: !!a.deactivated, followers, posts, openReportsAgainst: openReports,
    identities: ids.length, enforcements,
    ...(pii ? { email: a.email, realName: a.real_name, phone: a.phone } : {}),
  };
}

// ---------------- Generic sections ----------------
const col = (key, label) => ({ key, label });
const tbl = (columns, rows, extra = {}) => ({ columns, rows, actions: [], summary: [], ...extra });
const REASON = { key: "reason", label: "Reason / note" };

export const LIST = {
  // Is AI broken in the code, the key/provider, or the hosting network? Runs one tiny live request.
  async aihealth() {
    const { aiDiagnostics } = await import("@/lib/ai");
    const d = await aiDiagnostics();
    const rows = [
      { id: "verdict", check: "Verdict", result: d.verdict, state: d.live?.ok ? "ok" : "problem" },
      { id: "provider", check: "Provider / model", result: `${d.provider} / ${d.model}`, state: "info" },
      { id: "key", check: `Key (${d.keyVariable})`, result: d.keyPresent ? "present on the server" : "NOT SET on the server", state: d.keyPresent ? "ok" : "problem" },
      { id: "live", check: "Live request", result: d.live ? (d.live.ok ? `answered in ${d.live.ms} ms` : `failed after ${d.live.ms} ms`) : "skipped (no key)", state: d.live?.ok ? "ok" : "problem" },
      ...(d.lastError ? [{ id: "last", check: "Last provider error", result: `${d.lastError.status} at ${d.lastError.at.slice(0, 19).replace("T", " ")}: ${d.lastError.detail}`, state: "problem" }] : []),
      ...(d.baseUrl ? [{ id: "base", check: "Base URL", result: d.baseUrl, state: "info" }] : []),
    ];
    return tbl([col("check", "Check"), col("result", "Result"), col("state", "State")], rows, { summary: [["Code vs hosting", d.keyPresent ? (d.live?.ok ? "Code and hosting are fine" : "Code is fine; see the verdict row") : "Hosting config (missing key)"]] });
  },
  // View counts and trends, recorded server-side since round 9.
  async viewmetrics() {
    const { viewTotals } = await import("@/lib/views");
    const totals = await viewTotals();
    const days = Array.from({ length: 7 }, (_, i) => new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
    const top = await contentDb.prepare(`SELECT c.kind, c.item_id, c.total, c.uniques, c.last_at,
        COALESCE((SELECT SUM(n) FROM view_daily d WHERE d.kind = c.kind AND d.item_id = c.item_id AND d.day >= ?), 0) AS week,
        COALESCE((SELECT n FROM view_daily d WHERE d.kind = c.kind AND d.item_id = c.item_id AND d.day = ?), 0) AS today
      FROM view_counts c ORDER BY c.total DESC LIMIT 150`).all(days[6], days[0]);
    const title = async (kind, id) => {
      try {
        if (kind === "story") return (await contentDb.prepare("SELECT COALESCE(title, substr(body,1,70)) t FROM stories WHERE id = ?").get(id))?.t;
        if (kind === "post") return (await contentDb.prepare("SELECT COALESCE(title, substr(text,1,70)) t FROM posts WHERE id = ?").get(id))?.t;
        if (kind === "company") return (await contentDb.prepare("SELECT name t FROM companies WHERE id = ?").get(id))?.t;
      } catch {}
      return null;
    };
    const rows = [];
    for (const r of top) rows.push({ id: `${r.kind}:${r.item_id}`, kind: r.kind, item: (await title(r.kind, r.item_id)) || String(r.item_id).slice(0, 12), total: +r.total, uniques: +r.uniques, week: +r.week, today: +r.today, last: String(r.last_at || "").slice(0, 16).replace("T", " ") });
    const sum = (k) => totals.find((t) => t.kind === k)?.total || 0;
    return tbl([col("kind", "Type"), col("item", "Item"), col("total", "Total views"), col("uniques", "Unique viewers"), col("week", "Last 7 days"), col("today", "Today"), col("last", "Last viewed")], rows, {
      chips: "kind",
      summary: [...totals.map((t) => [`${t.kind} views`, `${t.total.toLocaleString()} (${t.items.toLocaleString()} items)`]), ["All views", totals.reduce((a, t) => a + t.total, 0).toLocaleString()], ["Story views", sum("story").toLocaleString()]],
    });
  },
  async analytics() {
    const days = Array.from({ length: 14 }, (_, i) => iso(i * 864e5).slice(0, 10));
    const per = async (db, table, extra = "") => new Map((await safe(() => db.prepare(`SELECT substr(created_at,1,10) d, COUNT(*) c FROM ${table} WHERE created_at >= ? ${extra} GROUP BY d`).all(iso(14 * 864e5)), [])).map((r) => [r.d, r.c]));
    const [su, po, co, re] = await Promise.all([per(identityDb, "accounts"), per(contentDb, "posts", "AND repost_of IS NULL"), per(contentDb, "comments"), per(contentDb, "reactions")]);
    const li = await per(contentDb, "likes");
    const da = new Map((await safe(() => identityDb.prepare("SELECT day d, COUNT(*) c FROM daily_active WHERE day >= ? GROUP BY day").all(iso(14 * 864e5).slice(0, 10)), [])).map((r) => [r.d, r.c]));
    const o = await overview();
    return tbl([col("day", "Day"), col("dau", "Active users"), col("signups", "Signups"), col("posts", "Posts"), col("replies", "Replies"), col("likes", "Likes"), col("reactions", "Reactions")],
      days.map((d) => ({ id: d, day: d, dau: +(da.get(d) || 0), signups: +(su.get(d) || 0), posts: +(po.get(d) || 0), replies: +(co.get(d) || 0), likes: +(li.get(d) || 0), reactions: +(re.get(d) || 0) })),
      { summary: [["DAU", o.kpis.dau], ["MAU", o.kpis.mau], ["Stickiness", o.kpis.mau ? Math.round((o.kpis.dau / o.kpis.mau) * 100) + "%" : "—"], ["New this week", o.kpis.newWeek]] });
  },

  async enforcements() {
    const r = await identityDb.prepare(`SELECT e.*, a.pseudonym FROM enforcements e LEFT JOIN accounts a ON a.id = e.account_id ORDER BY e.created_at DESC LIMIT 200`).all();
    return tbl([col("when", "When"), col("user", "Account"), col("action", "Action"), col("reason", "Reason"), col("by", "By"), col("state", "State")],
      r.map((x) => ({ id: x.id, when: x.created_at.slice(0, 16).replace("T", " "), user: x.pseudonym || x.account_id.slice(0, 8), action: x.action, reason: cut(x.reason), by: x.issued_by, state: x.revoked_at ? "revoked" : x.expires_at && x.expires_at < iso() ? "expired" : "active" })),
      { actions: [{ id: "revoke", label: "Revoke", perm: "users.enforce.severe", input: REASON, danger: false }] });
  },

  async verification(staff) {
    const r = await identityDb.prepare(`SELECT v.*, a.pseudonym FROM verification_requests v LEFT JOIN accounts a ON a.id = v.account_id ORDER BY (v.status='pending') DESC, v.created_at DESC LIMIT 100`).all();
    const actions = [{ id: "approved", label: "Approve", input: { key: "note", label: "Note (optional)", optional: true } }, { id: "rejected", label: "Reject", danger: true, input: REASON }];
    if (can(staff.role, "verification.docs")) actions.push({ id: "document", label: "View document" });
    return tbl([col("created", "Submitted"), col("user", "Account"), col("type", "Type"), col("notes", "Notes"), col("status", "Status"), col("doc", "Document")],
      r.map((x) => ({ id: x.id, created: x.created_at.slice(0, 16).replace("T", " "), user: x.pseudonym, type: x.type, notes: cut(x.submitted_data), status: x.status, doc: x.document_path ? "yes" : "no", _pending: x.status === "pending" })),
      { actions, pendingOnly: ["approved", "rejected"], summary: [["Pending", r.filter((x) => x.status === "pending").length]] });
  },

  async companies() {
    const r = await contentDb.prepare("SELECT id, name, industry, status, verification, domain_verified, created_at FROM companies ORDER BY (verification='submitted') DESC, created_at DESC LIMIT 500").all();
    const disputes = await safe(() => n(contentDb, "SELECT COUNT(*) AS n FROM company_disputes WHERE status='open'"));
    return tbl([col("name", "Company"), col("industry", "Industry"), col("status", "Status"), col("verification", "Verification"), col("domain", "Domain"), col("created", "Created")],
      r.map((x) => ({ id: x.id, name: x.name, industry: x.industry, status: x.status, verification: x.verification, domain: x.domain_verified ? "verified" : "—", created: x.created_at.slice(0, 10) })),
      { detail: true, summary: [["Companies", r.length], ["Open disputes", disputes]], actions: [{ id: "verify", label: "Verify" }, { id: "reject", label: "Reject", input: REASON }, { id: "revoke_verification", label: "Revoke verification", danger: true, input: REASON }, { id: "suspend", label: "Suspend", danger: true, input: REASON }, { id: "restore", label: "Restore" },
        { id: "set_plan", label: "Set plan (testing, no payment)", input: { key: "plan", label: "Plan", options: ["none", "business", "business_pro", "enterprise"] } },
        { id: "staff_note", label: "Add admin note", input: { key: "note", label: "Private note, visible to staff only" } },
        { id: "verify_fact", label: "Verify an official fact", input: { key: "section", label: "Fact", options: ["fact:employees", "fact:locations", "fact:founded", "fact:website", "fact:remote_policy", "fact:hiring_status"] } },
        { id: "remove_rep", label: "Remove a representative", danger: true, input: { key: "handle", label: "Representative handle (rep-xxxxxx)" } },
        { id: "terminate", label: "Terminate company account", danger: true, input: { key: "reason", label: "Type TERMINATE. Suspends the page, removes all representatives and ends any plan. Stories stay." } }, { id: "delete", label: "Delete permanently", danger: true, input: { key: "reason", label: "Type DELETE to permanently remove this company and everything attached to it (reviews, salaries, stories, documents, disputes). This cannot be undone." } }] });
  },

  async network() {
    const top = await identityDb.prepare("SELECT followed_handle h, COUNT(*) c FROM follows GROUP BY h ORDER BY c DESC LIMIT 15").all();
    const burst = await identityDb.prepare("SELECT f.follower_account_id id, a.pseudonym p, COUNT(*) c FROM follows f LEFT JOIN accounts a ON a.id = f.follower_account_id WHERE f.created_at >= ? GROUP BY f.follower_account_id, a.pseudonym HAVING COUNT(*) >= 25 ORDER BY c DESC LIMIT 25").all(iso(864e5));
    const topH = top.map((t) => t.h);
    const edgesRaw = topH.length ? await identityDb.prepare("SELECT a.pseudonym f, fl.followed_handle t FROM follows fl JOIN accounts a ON a.id = fl.follower_account_id WHERE fl.followed_handle = ANY(?) AND a.pseudonym IS NOT NULL LIMIT 500").all(topH) : [];
    const flagged = new Set(burst.map((b) => b.p));
    const deg = new Map(); const pair = new Set(edgesRaw.map((e) => e.f + ">" + e.t));
    for (const e of edgesRaw) { deg.set(e.t, (deg.get(e.t) || 0) + 1); if (!deg.has(e.f)) deg.set(e.f, 0); }
    const graph = { nodes: [...deg.entries()].slice(0, 160).map(([id, d]) => ({ id, followers: d, flagged: flagged.has(id) })), edges: edgesRaw.map((e) => ({ a: e.f, b: e.t, mutual: pair.has(e.t + ">" + e.f) })) };
    graph.edges = graph.edges.filter((e) => graph.nodes.some((n) => n.id === e.a) && graph.nodes.some((n) => n.id === e.b));
    return tbl([col("kind", "Signal"), col("who", "Account"), col("count", "Count")],
      [...burst.map((b) => ({ id: "b" + b.id, kind: "Mass-follow (24h)", who: b.p, count: +b.c })), ...top.map((t) => ({ id: "t" + t.h, kind: "Most followed", who: t.h, count: +t.c }))],
      { graph, summary: [["Follows (24h)", await safe(() => n(identityDb, "SELECT COUNT(*) AS n FROM follows WHERE created_at >= ?", iso(864e5)))], ["Mass-follow flags", burst.length]] });
  },

  async moderation() {
    const r = await contentDb.prepare(
      `SELECT p.id, p.type, p.text, p.author_display, p.visibility, p.flag, p.created_at, p.mod_reason,
        (SELECT COUNT(*) FROM content_reports r WHERE r.target_type='post' AND r.target_id = p.id AND r.status='open') AS reports
       FROM posts p WHERE p.repost_of IS NULL ORDER BY (SELECT COUNT(*) FROM content_reports r WHERE r.target_type='post' AND r.target_id = p.id AND r.status='open') DESC, p.created_at DESC LIMIT 100`).all();
    return tbl([col("created", "Posted"), col("author", "Author"), col("text", "Content"), col("reports", "Open reports"), col("visibility", "State")],
      r.map((x) => ({ id: x.id, created: x.created_at.slice(0, 16).replace("T", " "), author: x.author_display, text: cut(x.text, 120), reports: +x.reports, visibility: x.visibility })),
      { summary: [["Queue (reported)", r.filter((x) => +x.reports > 0).length]],
        actions: [{ id: "remove", label: "Remove", danger: true, input: REASON }, { id: "restore", label: "Restore" },
          { id: "warn_author", label: "Warn author", input: REASON }, { id: "limit_author", label: "Limit author posting", input: REASON }] });
  },

  async reports() {
    const r = await contentDb.prepare("SELECT * FROM content_reports ORDER BY (status='open') DESC, created_at DESC LIMIT 150").all();
    return tbl([col("created", "Filed"), col("target", "Target"), col("reason", "Reason"), col("details", "Details"), col("status", "Status")],
      r.map((x) => ({ id: x.id, created: x.created_at.slice(0, 16).replace("T", " "), target: `${x.target_type}:${x.target_id.slice(0, 8)}`, reason: x.reason, details: cut(x.details), status: x.status })),
      { detail: true, summary: [["Open", r.filter((x) => x.status === "open").length], ["Resolved", r.filter((x) => x.status !== "open").length]],
        pendingOnly: ["action_taken", "dismiss"],
        actions: [{ id: "action_taken", label: "Remove content", danger: true, input: REASON }, { id: "dismiss", label: "Dismiss", input: { key: "reason", label: "Note", optional: true } }] });
  },

  async appeals() {
    const r = await identityDb.prepare("SELECT ap.*, a.pseudonym FROM appeals ap LEFT JOIN accounts a ON a.id = ap.account_id ORDER BY (ap.status='pending') DESC, ap.created_at DESC LIMIT 100").all();
    const dec = r.filter((x) => x.decided_at);
    const acc = dec.filter((x) => x.status === "accepted").length;
    const avgH = dec.length ? Math.round(dec.reduce((s, x) => s + (new Date(x.decided_at) - new Date(x.created_at)), 0) / dec.length / 36e5) : 0;
    return tbl([col("created", "Filed"), col("user", "Account"), col("message", "Appeal"), col("status", "Status")],
      r.map((x) => ({ id: x.id, created: x.created_at.slice(0, 16).replace("T", " "), user: x.pseudonym, message: cut(x.message, 120), status: x.status })),
      { detail: true, summary: [["Pending", r.filter((x) => x.status === "pending").length], ["Accepted", acc], ["Rejected", dec.length - acc], ["Success rate", dec.length ? Math.round((acc / dec.length) * 100) + "%" : "—"], ["Avg processing", avgH + "h"]],
        pendingOnly: ["accepted", "rejected"],
        actions: [{ id: "accepted", label: "Accept & restore", perm: "appeals.handle", input: REASON }, { id: "rejected", label: "Reject", danger: true, perm: "appeals.handle", input: REASON }] });
  },

  async spam() {
    const dup = await contentDb.prepare("SELECT md5(text) h, MIN(text) sample, COUNT(*) c, COUNT(DISTINCT anonymous_id) a FROM posts WHERE created_at >= ? AND visibility <> 'removed' GROUP BY md5(text) HAVING COUNT(*) >= 3 ORDER BY c DESC LIMIT 30").all(iso(864e5));
    return tbl([col("sample", "Repeated content (24h)"), col("count", "Copies"), col("authors", "Distinct authors")],
      dup.map((d) => ({ id: d.h, sample: cut(d.sample, 100), count: +d.c, authors: +d.a })),
      { summary: [["Duplicate clusters", dup.length]], actions: [{ id: "remove_all", label: "Remove all copies", danger: true, input: REASON }] });
  },

  async dmca() {
    const r = await identityDb.prepare("SELECT * FROM dmca_notices ORDER BY (status='open') DESC, created_at DESC LIMIT 100").all();
    return tbl([col("created", "Received"), col("claimant", "Claimant"), col("post", "Post"), col("description", "Description"), col("status", "Status")],
      r.map((x) => ({ id: x.id, created: x.created_at.slice(0, 10), claimant: x.claimant, post: x.target_post_id || x.target_url, description: cut(x.description), status: x.status })),
      { detail: true, pendingOnly: ["takedown", "rejected"], actions: [{ id: "takedown", label: "Take down", danger: true }, { id: "rejected", label: "Reject", input: REASON }],
        create: [{ key: "claimant", label: "Claimant" }, { key: "target_post_id", label: "Post ID" }, { key: "description", label: "Description" }] });
  },

  async legal() {
    const r = await identityDb.prepare("SELECT * FROM legal_requests ORDER BY (status='open') DESC, deadline ASC NULLS LAST LIMIT 100").all();
    return tbl([col("agency", "Agency"), col("type", "Type"), col("subject", "Subject"), col("deadline", "Deadline"), col("status", "Status")],
      r.map((x) => ({ id: x.id, agency: x.agency, type: x.type, subject: cut(x.subject), deadline: x.deadline?.slice(0, 10), status: x.status })),
      { detail: true, pendingOnly: ["complied", "contested"], actions: [{ id: "complied", label: "Mark complied", input: REASON }, { id: "contested", label: "Contest", input: REASON }],
        create: [{ key: "agency", label: "Agency / court" }, { key: "type", label: "Type (subpoena, preservation…)" }, { key: "subject", label: "Subject" }, { key: "deadline", label: "Deadline (YYYY-MM-DD)" }] });
  },

  async breakglass() {
    const r = await identityDb.prepare("SELECT * FROM break_glass_requests ORDER BY requested_at DESC LIMIT 100").all();
    return tbl([col("requested", "Requested"), col("anon", "Anonymous ID"), col("reason", "Reason"), col("by", "Requested by"), col("status", "Status"), col("approver", "Approved by")],
      r.map((x) => ({ id: x.id, requested: x.requested_at.slice(0, 16).replace("T", " "), anon: x.anonymous_id.slice(0, 10) + "…", reason: cut(x.reason), by: x.requested_by, status: x.status, approver: x.approved_by || "—" })),
      { summary: [["Pending", r.filter((x) => x.status === "pending").length]] });
    // Read-only by design: filing/approving stays in scripts/break-glass-*.js (two distinct operators).
  },

  async feed() {
    const r = await contentDb.prepare("SELECT id, text, author_display, pinned, cringe_nominated, cringe_votes, visibility FROM posts WHERE (pinned = 1 OR cringe_nominated = 1) AND visibility <> 'removed' ORDER BY cringe_votes DESC LIMIT 60").all();
    return tbl([col("text", "Post"), col("author", "Author"), col("pinned", "Pinned"), col("cringe", "Cringe votes")],
      r.map((x) => ({ id: x.id, text: cut(x.text, 100), author: x.author_display, pinned: x.pinned ? "yes" : "—", cringe: x.cringe_nominated ? +x.cringe_votes : "—" })),
      { summary: [["Pinned", r.filter((x) => x.pinned).length], ["On cringe board", r.filter((x) => x.cringe_nominated).length]], create: [{ key: "post_id", label: "Post ID to pin (copy it from Content Moderation)" }], createLabel: "+ Pin a post",
        actions: [{ id: "unpin", label: "Unpin", when: { pinned: ["yes"] } }, { id: "denominate", label: "Remove from cringe board", when: { cringe: ["*"] } }, { id: "remove", label: "Remove post", danger: true, input: REASON }] });
  },

  async search() {
    const r = await contentDb.prepare("SELECT * FROM blocked_terms ORDER BY created_at DESC").all();
    return tbl([col("term", "Blocked term"), col("by", "Added by"), col("created", "Added")],
      r.map((x) => ({ id: x.term, term: x.term, by: x.added_by, created: x.created_at.slice(0, 10) })),
      { actions: [{ id: "unblock", label: "Unblock" }], create: [{ key: "term", label: "Term to block from search" }] });
  },

  async dm() {
    const [today, blocks, open] = await Promise.all([safe(() => n(contentDb, "SELECT COUNT(*) AS n FROM dm_messages WHERE created_at >= ?", day0())), safe(() => n(contentDb, "SELECT COUNT(*) AS n FROM dm_blocks")), safe(() => n(contentDb, "SELECT COUNT(*) AS n FROM dm_reports WHERE status='open'"))]);
    const r = await contentDb.prepare("SELECT id, reason, details, status, created_at, (evidence_enc IS NOT NULL) AS has_evidence FROM dm_reports ORDER BY (status='open') DESC, created_at DESC LIMIT 100").all();
    return tbl([col("created", "Filed"), col("reason", "Reason"), col("details", "Details"), col("evidence", "Reporter evidence"), col("status", "Status")],
      r.map((x) => ({ id: x.id, created: x.created_at.slice(0, 16).replace("T", " "), reason: x.reason, details: cut(x.details), evidence: x.has_evidence ? "attached (encrypted)" : "—", status: x.status })),
      { pendingOnly: ["actioned", "dismissed"], summary: [["Messages today", today], ["Blocked pairs", blocks], ["Open abuse reports", open], ["Encryption at rest", "100%"]],
        actions: [{ id: "actioned", label: "Mark actioned", input: REASON }, { id: "dismissed", label: "Dismiss" }] });
    // Message bodies are never decrypted here — only reporter-submitted evidence and metadata.
  },

  async rooms() {
    const r = await contentDb.prepare("SELECT id, topic, vibe, status, locked, created_by_display, created_at FROM rooms ORDER BY created_at DESC LIMIT 80").all();
    return tbl([col("topic", "Topic"), col("vibe", "Vibe"), col("host", "Host"), col("status", "Status"), col("locked", "Locked")],
      r.map((x) => ({ id: x.id, topic: cut(x.topic, 70), vibe: x.vibe, host: x.created_by_display, status: x.status, locked: x.locked ? "yes" : "no" })),
      { chips: "status", summary: [["Live now", r.filter((x) => x.status === "live").length], ["Ended", r.filter((x) => x.status === "ended").length]],
        actions: [
          { id: "end", label: "End room…", danger: true, when: { status: ["live"] }, input: { key: "mode", label: "What should happen to this room?", options: ["End room only", "End and delete the room"] } },
          { id: "delete", label: "Delete room", danger: true, input: REASON },
          { id: "lock", label: "Lock", when: { locked: ["no"] } }, { id: "unlock", label: "Unlock", when: { locked: ["yes"] } }] });
  },

  async jobs() {
    const r = await safe(() => contentDb.prepare("SELECT id, title, company_name, created_at FROM jobs ORDER BY created_at DESC LIMIT 60").all(), []);
    return tbl([col("title", "Title"), col("company", "Company"), col("created", "Created")], r.map((x) => ({ id: x.id, title: x.title, company: x.company_name, created: x.created_at.slice(0, 10) })),
      { summary: [["Module", "Paused (JOBS_ENABLED = false)"]] });
  },

  async payments() {
    const tiers = await identityDb.prepare("SELECT premium_tier t, COUNT(*) c FROM accounts GROUP BY premium_tier").all();
    const ev = await identityDb.prepare("SELECT b.*, a.pseudonym FROM billing_events b LEFT JOIN accounts a ON a.id = b.account_id ORDER BY b.created_at DESC LIMIT 100").all();
    const paid = tiers.filter((t) => PRICE[t.t]);
    return tbl([col("when", "When"), col("user", "Account"), col("event", "Event")],
      ev.map((x) => ({ id: x.id, when: x.created_at.slice(0, 16).replace("T", " "), user: x.pseudonym, event: x.event })),
      { summary: [...tiers.map((t) => [`${t.t} accounts`, +t.c]), ["MRR (estimate)", "$" + paid.reduce((s, t) => s + PRICE[t.t] * +t.c, 0).toFixed(2)]] });
  },

  async ads() {
    const r = await contentDb.prepare("SELECT id, data, review_status FROM ads ORDER BY id").all();
    return tbl([col("name", "Ad"), col("copy", "Copy"), col("review", "Review status")],
      r.map((x) => { const d = JSON.parse(x.data); return { id: String(x.id), name: d.brand || d.advertiser || d.title || `Ad ${x.id}`, copy: cut(d.text || d.body || d.headline || "", 100), review: x.review_status }; }),
      { actions: [{ id: "approved", label: "Approve" }, { id: "rejected", label: "Reject", danger: true }, { id: "paused", label: "Pause" }] });
  },

  async support() {
    const r = await identityDb.prepare("SELECT t.*, a.pseudonym FROM support_tickets t LEFT JOIN accounts a ON a.id = t.account_id ORDER BY (t.status='open') DESC, t.created_at DESC LIMIT 100").all();
    return tbl([col("created", "Opened"), col("user", "Account"), col("subject", "Subject"), col("priority", "Priority"), col("status", "Status")],
      r.map((x) => ({ id: x.id, created: x.created_at.slice(0, 16).replace("T", " "), user: x.pseudonym || "—", subject: cut(x.subject), priority: x.priority, status: x.status })),
      { summary: [["Open", r.filter((x) => x.status === "open").length]], pendingOnly: ["resolved", "in_progress"], actions: [{ id: "in_progress", label: "Take" }, { id: "resolved", label: "Resolve", input: { key: "reason", label: "Resolution note", optional: true } }] });
  },

  async security() {
    const r = await identityDb.prepare("SELECT action, COUNT(*) c FROM throttle_events WHERE created_at >= ? GROUP BY action ORDER BY c DESC").all(iso(864e5));
    const sms = await safe(() => n(identityDb, "SELECT COUNT(*) AS n FROM sms_events WHERE created_at >= ?", iso(864e5)));
    const sev = await safe(() => n(identityDb, "SELECT COUNT(*) AS n FROM enforcements WHERE action IN ('temp_suspend','perm_suspend','temp_lock') AND created_at >= ?", iso(864e5)));
    // Staff 2FA (TOTP) IS implemented and enforced for every /api/admin call (lib/admin/twofactor.js);
    // report the real enrolment numbers instead of a placeholder.
    const staffTotal = await safe(() => n(identityDb, "SELECT COUNT(*) AS n FROM accounts WHERE role <> 'user'"));
    const staff2fa = await safe(() => n(identityDb, "SELECT COUNT(*) AS n FROM accounts WHERE role <> 'user' AND totp_enabled = 1"));
    return tbl([col("signal", "Throttle bucket (24h)"), col("count", "Events")], r.map((x) => ({ id: x.action, signal: x.action, count: +x.c })),
      { summary: [["Throttled actions (24h)", r.reduce((s, x) => s + +x.c, 0)], ["SMS codes sent (24h)", sms], ["Severe enforcements (24h)", sev], ["Staff 2FA", staffTotal ? `enforced · ${staff2fa}/${staffTotal} staff enrolled` : "enforced"]] });
  },

  async infra() {
    const t = async (db) => { const s = Date.now(); await db.prepare("SELECT 1 AS n").get(); return Date.now() - s; };
    const [li, lc] = await Promise.all([safe(() => t(identityDb), -1), safe(() => t(contentDb), -1)]);
    const env = (k) => (process.env[k] ? "configured" : "missing");
    const rows = [["Identity DB", li >= 0 ? `ok · ${li}ms` : "down"], ["Content DB", lc >= 0 ? `ok · ${lc}ms` : "down"], ["Object storage (B2)", env("B2_KEY_ID")], ["Stripe", env("STRIPE_SECRET_KEY")], ["Email (Resend)", env("RESEND_API_KEY")], ["SMS (Telnyx)", env("TELNYX_API_KEY")], ["LiveKit (Vent audio)", env("LIVEKIT_API_KEY")], ["GIFs (KLIPY)", env("KLIPY_API_KEY")]];
    const m = process.memoryUsage();
    return tbl([col("service", "Service"), col("status", "Status")], rows.map(([s, v]) => ({ id: s, service: s, status: v })),
      { summary: [["Process uptime", Math.round(process.uptime() / 60) + "m"], ["Heap", Math.round(m.heapUsed / 1048576) + " MB"], ["Node", process.version]] });
  },

  async staff() {
    const r = await identityDb.prepare("SELECT id, pseudonym, email, role, last_seen_at FROM accounts WHERE role <> 'user' ORDER BY role, pseudonym").all();
    const roles = await (await import("./rbac")).roleKeys();
    return tbl([col("pseudonym", "Handle"), col("email", "Email"), col("role", "Role"), col("seen", "Last active")],
      r.map((x) => ({ id: x.id, pseudonym: x.pseudonym, email: x.email, role: x.role, seen: x.last_seen_at?.slice(0, 16).replace("T", " ") || "—" })),
      { actions: [{ id: "set_role", label: "Change role", input: { key: "role", label: "New role", options: roles } }, { id: "reset_2fa", label: "Reset 2FA" }, { id: "revoke", label: "Revoke access", danger: true }],
        create: [{ key: "email", label: "Account email" }, { key: "role", label: "Role", options: roles }] });
  },

  async audit() {
    const r = await identityDb.prepare("SELECT l.*, a.pseudonym FROM staff_audit_log l LEFT JOIN accounts a ON a.id = l.actor_id ORDER BY l.created_at DESC LIMIT 300").all();
    return tbl([col("when", "When"), col("actor", "Actor"), col("role", "Role"), col("action", "Action"), col("target", "Target"), col("detail", "Detail")],
      r.map((x) => ({ id: x.id, when: x.created_at.slice(0, 19).replace("T", " "), actor: x.pseudonym || x.actor_id.slice(0, 8), role: x.actor_role, action: x.action, target: x.target ? String(x.target).slice(0, 12) : "", detail: cut(x.detail) })));
  },
};

// ---------------- Row actions ----------------
const setPost = (id, vis, staff, reason) => contentDb.prepare("UPDATE posts SET visibility=?, moderated_by=?, moderated_at=?, mod_reason=? WHERE id=?").run(vis, staff.id, iso(), reason || null, id);
async function enforceViaPost(staff, postId, action, reason) {
  const p = await contentDb.prepare("SELECT anonymous_id FROM posts WHERE id = ?").get(postId);
  const acct = p?.anonymous_id && (await accountIdForAnonymousId(p.anonymous_id));
  if (!acct) throw bad("This post has no linked account (nothing to enforce).");
  await applyEnforcement(staff, acct, action, { reason });
}

export const ACT = {
  async enforcements(staff, id, a, b) {
    if (a !== "revoke") throw bad("Unknown action.");
    const e = await identityDb.prepare("SELECT account_id FROM enforcements WHERE id = ?").get(id);
    if (!e) throw bad("Not found.", 404);
    await applyEnforcement(staff, e.account_id, "restore", { reason: b.reason || "Revoked" });
  },
  async verification(staff, id, a, b) {
    if (a === "document") {
      const r = await identityDb.prepare("SELECT document_path FROM verification_requests WHERE id = ?").get(id);
      if (!r?.document_path) throw bad("No document attached.");
      await logStaff(staff, "view_verification_document", id);
      return { url: await getVerificationDocumentSignedUrl(r.document_path) };
    }
    if (a === "rejected" && !b.reason) throw bad("A reason is required to reject.");
    await reviewVerificationRequest(id, a, staff.pseudonym || staff.id, b.note || b.reason || "");
  },
  async companies(staff, id, a, b) {
    const audit = (action, detail) => contentDb.prepare("INSERT INTO company_audit (id, company_id, actor, action, detail, created_at) VALUES (?,?,?,?,?,?)").run(uid(), id, "staff:" + staff.id, action, detail || null, iso());
    if (a === "set_plan") {
      if (!can(staff.role, "gates.bypass") && !can(staff.role, "payments.manage")) throw bad("Your role can't change plans.", 403);
      const { setCompanyPlanForTesting, planOf } = await import("@/lib/stories/business");
      const cur = await planOf(id);
      if (cur.source === "stripe" && cur.status === "active" && cur.plan !== "none") throw bad("This company has a paid Stripe subscription. Change it in Stripe, not here, so billing and access stay in step.");
      await setCompanyPlanForTesting({ companyId: id, plan: b.plan, staffId: staff.id }); await logStaff(staff, "company_plan_test", id, b.plan); return;
    }
    if (a === "staff_note") { if (!String(b.note || "").trim()) throw bad("Write a note."); await audit("staff_note", String(b.note).slice(0, 500)); return; }
    if (a === "revoke_verification") { if (!String(b.reason || "").trim()) throw bad("A reason is required."); await contentDb.prepare("UPDATE companies SET verification='unverified', verification_note=? WHERE id=?").run(b.reason, id); await audit("verification_revoked", b.reason); await logStaff(staff, "company_unverify", id, b.reason); return; }
    if (a === "verify_fact") { const r = await contentDb.prepare("UPDATE company_profile SET verified = 1 WHERE company_id = ? AND section = ?").run(id, b.section); if (!r.changes) throw bad("That fact hasn't been filled in."); await audit("fact_verified", b.section); return; }
    if (a === "remove_rep") { const { repKeyByHandle } = await import("@/lib/stories/business"); const t = await repKeyByHandle(id, String(b.handle || "").trim()); if (!t || t.role === "owner") throw bad("No such non-owner representative."); await contentDb.prepare("DELETE FROM company_reps WHERE company_id = ? AND anon_key = ?").run(id, t.key); await audit("rep_removed_by_staff", b.handle); return; }
    if (a === "terminate") {
      if ((b.reason || "").trim() !== "TERMINATE") throw bad("Type TERMINATE (in capitals) to confirm.");
      await contentDb.prepare("UPDATE companies SET status='suspended' WHERE id=?").run(id); await contentDb.prepare("DELETE FROM company_reps WHERE company_id = ?").run(id);
      const { setCompanyPlan } = await import("@/lib/stories/business"); await setCompanyPlan({ companyId: id, plan: "none", status: "inactive", source: "admin_test", actor: `staff:${staff.id}` });
      await audit("account_terminated"); await logStaff(staff, "company_terminate", id); return;
    }
    if (a === "delete") {
      if ((b.reason || "").trim() !== "DELETE") throw bad("Type DELETE (in capitals) to confirm.");
      const co = await contentDb.prepare("SELECT id, name FROM companies WHERE id = ?").get(id);
      if (!co) throw bad("That company no longer exists.", 404);
      // Best-effort removal of uploaded verification documents from storage first.
      try {
        const docs = await contentDb.prepare("SELECT file_key FROM company_documents WHERE company_id = ?").all(id);
        const { deletePrivateObject } = await import("@/lib/storage");
        for (const d of docs) await deletePrivateObject(d.file_key).catch(() => {});
      } catch { /* storage cleanup is best effort */ }
      for (const t of ["company_reviews", "company_salaries", "company_horror_stories", "company_documents", "company_disputes", "company_domain_codes", "company_audit"]) {
        await contentDb.prepare(`DELETE FROM ${t} WHERE company_id = ?`).run(id).catch(() => {});
      }
      await contentDb.prepare("DELETE FROM content_reports WHERE target_type='company' AND target_id = ?").run(id).catch(() => {});
      await contentDb.prepare("DELETE FROM companies WHERE id = ?").run(id);
      await logStaff(staff, "company_deleted", id, JSON.stringify({ name: co.name }));
      return;
    }
    const sql = { verify: "UPDATE companies SET verification='verified', verified_at=? WHERE id=?", reject: "UPDATE companies SET verification='rejected', verification_note=? WHERE id=?",
      suspend: "UPDATE companies SET status='suspended' WHERE id=?", restore: "UPDATE companies SET status='active' WHERE id=?" }[a];
    if (!sql) throw bad("Unknown action.");
    const p = a === "verify" ? [iso(), id] : a === "reject" ? [b.reason || "", id] : [id];
    await contentDb.prepare(sql).run(...p);
    await contentDb.prepare("INSERT INTO company_audit (id, company_id, actor, action, detail, created_at) VALUES (?,?,?,?,?,?)").run(uid(), id, "staff:" + staff.id, a, b.reason || null, iso());
  },
  async moderation(staff, id, a, b) {
    if (a === "remove") await setPost(id, "removed", staff, b.reason);
    else if (a === "restore") await setPost(id, "public", staff, null);
    else if (a === "warn_author") await enforceViaPost(staff, id, "warning", b.reason);
    else if (a === "limit_author") await enforceViaPost(staff, id, "limit_posting", b.reason);
    else throw bad("Unknown action.");
  },
  async reports(staff, id, a, b) {
    const r = await contentDb.prepare("SELECT * FROM content_reports WHERE id = ?").get(id);
    if (!r) throw bad("Not found.", 404);
    if (a === "action_taken" && r.target_type === "post") await setPost(r.target_id, "removed", staff, b.reason);
    if (a === "action_taken" && r.target_type === "room") await contentDb.prepare("UPDATE rooms SET status='ended', ended_at=? WHERE id=?").run(iso(), r.target_id);
    await contentDb.prepare("UPDATE content_reports SET status=?, resolution=?, handled_by=?, resolved_at=? WHERE id=?").run(a === "dismiss" ? "dismissed" : "actioned", b.reason || null, staff.id, iso(), id);
  },
  async appeals(staff, id, a, b) {
    const ap = await identityDb.prepare("SELECT * FROM appeals WHERE id = ?").get(id);
    if (!ap || ap.status !== "pending") throw bad("Appeal is not pending.");
    if (a === "accepted") await applyEnforcement(staff, ap.account_id, "restore", { reason: `Appeal accepted: ${b.reason}` });
    await identityDb.prepare("UPDATE appeals SET status=?, decided_by=?, decision_note=?, decided_at=? WHERE id=?").run(a, staff.id, b.reason || "", iso(), id);
    const { createNotification } = await import("@/lib/identity/service");
    await createNotification(ap.account_id, "enforcement", a === "accepted" ? "Your appeal was accepted and your account restored." : `Your appeal was reviewed and declined. ${b.reason || ""}`).catch(() => {});
  },
  async spam(staff, id, a, b) {
    if (a !== "remove_all") throw bad("Unknown action.");
    await contentDb.prepare("UPDATE posts SET visibility='removed', moderated_by=?, moderated_at=?, mod_reason=? WHERE md5(text)=? AND created_at >= ?").run(staff.id, iso(), b.reason || "spam", id, iso(864e5));
  },
  async dmca(staff, id, a, b) {
    const d = await identityDb.prepare("SELECT target_post_id FROM dmca_notices WHERE id = ?").get(id);
    if (!d) throw bad("Not found.", 404);
    if (a === "takedown" && d.target_post_id) await setPost(d.target_post_id, "removed", staff, "DMCA takedown");
    await identityDb.prepare("UPDATE dmca_notices SET status=?, handled_by=? WHERE id=?").run(a, staff.id, id);
  },
  async legal(staff, id, a, b) { await identityDb.prepare("UPDATE legal_requests SET status=?, handled_by=?, note=? WHERE id=?").run(a, staff.id, b.reason || null, id); },
  async feed(staff, id, a, b) {
    if (a === "unpin") await contentDb.prepare("UPDATE posts SET pinned=0 WHERE id=?").run(id);
    else if (a === "denominate") await contentDb.prepare("UPDATE posts SET cringe_nominated=0 WHERE id=?").run(id);
    else if (a === "remove") await setPost(id, "removed", staff, b.reason);
    else throw bad("Unknown action.");
  },
  async search(staff, id, a) { if (a === "unblock") await contentDb.prepare("DELETE FROM blocked_terms WHERE term=?").run(id); },
  async dm(staff, id, a) { await contentDb.prepare("UPDATE dm_reports SET status=? WHERE id=?").run(a, id); },
  async rooms(staff, id, a, b) {
    if (a === "delete" || (a === "end" && /delete/i.test(b?.mode || ""))) {
      await contentDb.prepare("DELETE FROM room_participants WHERE room_id=?").run(id);
      await contentDb.prepare("DELETE FROM room_bans WHERE room_id=?").run(id);
      await contentDb.prepare("DELETE FROM content_reports WHERE target_type='room' AND target_id=?").run(id);
      await contentDb.prepare("DELETE FROM rooms WHERE id=?").run(id);
      return;
    }
    const sql = { end: ["UPDATE rooms SET status='ended', ended_at=? WHERE id=?", [iso(), id]], lock: ["UPDATE rooms SET locked=1 WHERE id=?", [id]], unlock: ["UPDATE rooms SET locked=0 WHERE id=?", [id]] }[a];
    if (!sql) throw bad("Unknown action."); await contentDb.prepare(sql[0]).run(...sql[1]);
  },
  async ads(staff, id, a) { await contentDb.prepare("UPDATE ads SET review_status=? WHERE id=?").run(a, +id); },
  async support(staff, id, a) { await identityDb.prepare("UPDATE support_tickets SET status=?, handled_by=? WHERE id=?").run(a, staff.id, id); },
  async staff(staff, id, a, b) {
    if (id === staff.id) throw bad("You can't change your own role.");
    if (a === "reset_2fa") { const { resetTwoFactor } = await import("./twofactor"); await resetTwoFactor(id); return; }
    const role = a === "revoke" ? "user" : b.role;
    await (await import("@/lib/security/core")).assertRoleChangesAllowed();
    if (role === "admin" || role === "super_admin") (await import("@/lib/security/core")).notePrivilegeChange(staff, { target: id, change: `account set to ${role}` }).catch(() => {});
    if (role !== "user" && !(await (await import("./rbac")).roleKeys()).includes(role)) throw bad("That role doesn't exist.");
    await identityDb.prepare("UPDATE accounts SET role=? WHERE id=?").run(role, id);
  },
};

export const CREATE = {
  async feed(staff, b) {
    const p = await contentDb.prepare("SELECT id, visibility FROM posts WHERE id = ?").get((b.post_id || "").trim());
    if (!p) throw bad("No post with that ID."); if (p.visibility === "removed") throw bad("That post was removed.");
    await contentDb.prepare("UPDATE posts SET pinned = 1 WHERE id = ?").run(p.id);
  },
  async dmca(staff, b) { await identityDb.prepare("INSERT INTO dmca_notices (id, claimant, target_post_id, description, created_at) VALUES (?,?,?,?,?)").run(uid(), b.claimant, b.target_post_id || null, b.description || "", iso()); },
  async legal(staff, b) { await identityDb.prepare("INSERT INTO legal_requests (id, agency, type, subject, deadline, created_at) VALUES (?,?,?,?,?,?)").run(uid(), b.agency, b.type, b.subject || "", b.deadline || null, iso()); },
  async search(staff, b) { if (!b.term?.trim()) throw bad("Term required."); await contentDb.prepare("INSERT INTO blocked_terms (term, added_by, created_at) VALUES (?,?,?) ON CONFLICT (term) DO NOTHING").run(b.term.trim().toLowerCase(), staff.pseudonym || staff.id, iso()); },
  async staff(staff, b) {
    if (!(await (await import("./rbac")).roleKeys()).includes(b.role)) throw bad("That role doesn't exist.");
    const r = await identityDb.prepare("UPDATE accounts SET role=? WHERE lower(email)=lower(?)").run(b.role, b.email);
    if (!r.changes) throw bad("No account with that email.", 404);
  },
};

export async function setPlanForTesting(staff, accountId, tier) {
  if (!can(staff.role, "gates.bypass")) throw bad("Your role can't change plans.", 403);
  // Business plans belong to a company page, not a person. "Switch this user to Business" gives every company page this
  // user owns that plan, so the real company console can be tested end to end. No payment, clearly marked, logged.
  if (["none", "business", "business_pro", "enterprise"].includes(tier) && tier !== "none") {
    const aliases = (await identityDb.prepare("SELECT anonymous_id FROM anonymous_identities WHERE account_id = ?").all(accountId)).map((x) => x.anonymous_id);
    const owned = aliases.length ? await contentDb.prepare("SELECT id, name FROM companies WHERE owner_key = ANY(?) AND status = 'active'").all(aliases) : [];
    if (!owned.length) throw bad("This user doesn't own a company page yet. Create one for them, or set the plan from Companies & Orgs.");
    const { setCompanyPlanForTesting } = await import("@/lib/stories/business");
    for (const c of owned) await setCompanyPlanForTesting({ companyId: c.id, plan: tier, staffId: staff.id });
    await logStaff(staff, "set_company_plan", accountId, `${tier} on ${owned.map((c) => c.name).join(", ")}`);
    return { companies: owned.map((c) => c.name) };
  }
  if (!["basic", "plus", "pro"].includes(tier)) throw bad("Pick basic, plus, pro, business, business_pro or enterprise.");
  const { setPremiumTier } = await import("@/lib/identity/service");
  await setPremiumTier(accountId, tier);
  await logStaff(staff, "set_plan", accountId, tier);
}

// ---------------- Detail pages ----------------
const kv = (o) => Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => [k, String(v)]);
const ts = (v) => (v ? String(v).slice(0, 16).replace("T", " ") : "");

export const DETAIL = {
  async reports(staff, id) {
    const r = await contentDb.prepare("SELECT * FROM content_reports WHERE id = ?").get(id);
    if (!r) throw bad("No such report.", 404);
    const same = await contentDb.prepare("SELECT reason, status, COUNT(*) c FROM content_reports WHERE target_type=? AND target_id=? GROUP BY reason, status").all(r.target_type, r.target_id);
    const blocks = [{ title: "Report", rows: kv({ "Filed": ts(r.created_at), "Reason": r.reason, "Status": r.status, "Handled by": r.handled_by, "Resolved": ts(r.resolved_at), "Resolution": r.resolution }) },
      { title: "All reports on this target", rows: same.map((x) => [`${x.reason} (${x.status})`, String(x.c)]) }];
    let text = null;
    if (r.target_type === "post") {
      const p = await contentDb.prepare("SELECT id, type, title, text, author_display, visibility, created_at, media_path, anonymous_id, mod_reason FROM posts WHERE id = ?").get(r.target_id);
      if (p) {
        text = { title: "Reported post", body: (p.title ? p.title + "\n\n" : "") + p.text };
        const acct = p.anonymous_id && (await accountIdForAnonymousId(p.anonymous_id));
        const prior = acct ? await safe(() => n(identityDb, "SELECT COUNT(*) AS n FROM enforcements WHERE account_id = ?", acct)) : 0;
        const posts = p.anonymous_id ? await safe(() => n(contentDb, "SELECT COUNT(*) AS n FROM posts WHERE anonymous_id = ?", p.anonymous_id)) : 0;
        blocks.push({ title: "Post", rows: kv({ "Author (as displayed)": p.author_display, "Type": p.type, "Posted": ts(p.created_at), "State": p.visibility, "Media": p.media_path ? "attached" : "", "Removal reason": p.mod_reason }) });
        blocks.push({ title: "Author context (identity hidden)", rows: kv({ "Posts by this identity": posts, "Prior enforcements on the account": prior }) });
      } else text = { title: "Reported post", body: "(post no longer exists)" };
    } else blocks.push({ title: "Target", rows: kv({ Type: r.target_type, ID: r.target_id }) });
    if (r.details) text = { ...(text || {}), note: { title: "Reporter's details", body: r.details } };
    return { title: `Report · ${r.reason}`, status: r.status, blocks, text, open: r.status === "open" };
  },
  async appeals(staff, id) {
    const a = await identityDb.prepare("SELECT ap.*, acc.pseudonym, acc.email, acc.status AS acct_status, acc.created_at AS acct_created FROM appeals ap LEFT JOIN accounts acc ON acc.id = ap.account_id WHERE ap.id = ?").get(id);
    if (!a) throw bad("No such appeal.", 404);
    const enf = a.enforcement_id ? await identityDb.prepare("SELECT action, reason, issued_by, expires_at, created_at FROM enforcements WHERE id = ?").get(a.enforcement_id) : null;
    const hist = await identityDb.prepare("SELECT action, reason, created_at, revoked_at FROM enforcements WHERE account_id = ? ORDER BY created_at DESC LIMIT 20").all(a.account_id);
    const prev = await identityDb.prepare("SELECT status, created_at FROM appeals WHERE account_id = ? AND id <> ? ORDER BY created_at DESC LIMIT 10").all(a.account_id, id);
    const pii = can(staff.role, "users.pii");
    await logStaff(staff, "view_appeal", id);
    return { title: `Appeal · ${a.pseudonym || "account"}`, status: a.status, open: a.status === "pending", userId: a.account_id,
      text: { title: "Their appeal", body: a.message },
      blocks: [
        { title: "Appeal", rows: kv({ Filed: ts(a.created_at), Status: a.status, "Decided by": a.decided_by, Decided: ts(a.decided_at), "Decision note": a.decision_note, "Time to decide": a.decided_at ? Math.round((new Date(a.decided_at) - new Date(a.created_at)) / 36e5) + "h" : "" }) },
        { title: "Account", rows: kv({ Handle: a.pseudonym, ...(pii ? { Email: a.email } : {}), "Account status": a.acct_status, "Member since": ts(a.acct_created) }) },
        ...(enf ? [{ title: "Enforcement being appealed", rows: kv({ Action: enf.action, Reason: enf.reason, "Issued by": enf.issued_by, Issued: ts(enf.created_at), Expires: ts(enf.expires_at) }) }] : []),
        { title: "Enforcement history", rows: hist.length ? hist.map((h) => [`${ts(h.created_at)} · ${h.action}${h.revoked_at ? " (revoked)" : ""}`, h.reason]) : [["None", ""]] },
        { title: "Previous appeals", rows: prev.length ? prev.map((p) => [ts(p.created_at), p.status]) : [["None", ""]] },
      ] };
  },
  async dmca(staff, id) {
    const d = await identityDb.prepare("SELECT * FROM dmca_notices WHERE id = ?").get(id);
    if (!d) throw bad("No such notice.", 404);
    return { title: `DMCA · ${d.claimant}`, status: d.status, open: d.status === "open", text: { title: "Description of the work & claim", body: [d.work_description, d.description].filter(Boolean).join("\n\n") || "(none)" },
      blocks: [{ title: "Notice", rows: kv({ Received: ts(d.created_at), Source: d.source, Claimant: d.claimant, Email: d.claimant_email, "Post ID": d.target_post_id, URL: d.target_url, Signature: d.signature, Status: d.status, "Handled by": d.handled_by }) }] };
  },
  async legal(staff, id) {
    const d = await identityDb.prepare("SELECT * FROM legal_requests WHERE id = ?").get(id);
    if (!d) throw bad("No such request.", 404);
    return { title: `Legal · ${d.agency}`, status: d.status, open: d.status === "open", text: { title: "Request details", body: [d.subject, d.details].filter(Boolean).join("\n\n") || "(none)" },
      blocks: [{ title: "Request", rows: kv({ Received: ts(d.created_at), Source: d.source, Agency: d.agency, Type: d.type, "Contact name": d.requester_name, "Contact email": d.requester_email, Reference: d.reference, Deadline: ts(d.deadline), Status: d.status, "Handled by": d.handled_by, Note: d.note }) }] };
  },
};

// Register the larger systems (ads, support, billing, feed controls, DM investigations).
Object.assign(LIST, SYS.LIST); Object.assign(ACT, SYS.ACT); Object.assign(CREATE, SYS.CREATE); Object.assign(DETAIL, SYS.DETAIL);
export { badges, globalSearch, getFeedSettings } from "./systems";

// =====================================================================================
// Stories & Reality (round 6). Staff act on story ids and alias handles only; no account is
// ever shown here. Removing a story keeps the row (status 'removed') so appeals can be reviewed.
// =====================================================================================
const storyWho = (x) => `${x.format}${x.company_name ? " · " + x.company_name : ""}`;
const SSTAT = { published: "published", removed: "removed", draft: "draft", scheduled: "scheduled" };

LIST.stories = async function stories(staff, query = {}) {
  const q = (query.q || "").trim();
  await contentDb.prepare("ALTER TABLE stories ADD COLUMN IF NOT EXISTS featured INTEGER NOT NULL DEFAULT 0").run().catch(() => {});
  const r = await contentDb.prepare(
    `SELECT id, format, company_name, title, body, status, noindex, views, author_display, created_at, mod_reason, featured,
            (SELECT COUNT(*) FROM story_disputes d WHERE d.story_id = stories.id AND d.status = 'open') AS open_reports
     FROM stories ${q ? "WHERE (title ILIKE ? OR body ILIKE ? OR company_name ILIKE ?)" : ""} ORDER BY open_reports DESC, created_at DESC LIMIT 200`
  ).all(...(q ? Array(3).fill(`%${q.replace(/[%_]/g, "")}%`) : []));
  return tbl([col("when", "Posted"), col("what", "Type · company"), col("excerpt", "Story"), col("by", "By"), col("status", "Status"), col("reports", "Open reports"), col("index", "Search engines"), col("featured", "Featured"), col("views", "Views")],
    r.map((x) => ({ id: x.id, when: x.created_at.slice(0, 16).replace("T", " "), what: storyWho(x), excerpt: cut(x.title || x.body, 110), by: x.author_display, status: x.status, reports: +x.open_reports || "", index: x.noindex ? "hidden" : "indexable", views: x.views, featured: x._f ? "yes" : (x.featured ? "yes" : "no"), _form: { title: x.title || "", body: x.body, company_name: x.company_name || "" } })),
    { chips: "status", actions: [
      { id: "edit", label: "Edit", form: [{ key: "title", label: "Title", optional: true }, { key: "body", label: "Story text", long: true }, { key: "company_name", label: "Company name", optional: true }, { key: "reason", label: "Why you are editing it (kept in the audit log)" }] },
      { id: "feature", label: "Feature", when: { featured: ["no"], status: ["published"] } },
      { id: "unfeature", label: "Unfeature", when: { featured: ["yes"] } },
      { id: "unpublish", label: "Unpublish (back to draft)", when: { status: ["published"] }, input: REASON },
      { id: "remove", label: "Remove story", danger: true, input: REASON },
      { id: "restore", label: "Restore story" },
      { id: "noindex", label: "Hide from search engines" },
      { id: "index", label: "Allow search engines" },
      { id: "purge", label: "Delete permanently", danger: true, input: { key: "reason", label: "Type DELETE to permanently erase this story with its updates, evidence, responses, reports and view history. This cannot be undone." } },
    ], summary: [["Published", r.filter((x) => x.status === "published").length], ["With open reports", r.filter((x) => +x.open_reports > 0).length], ["Removed", r.filter((x) => x.status === "removed").length]] });
};
DETAIL.stories = async function (staff, id) {
  const x = await contentDb.prepare("SELECT * FROM stories WHERE id = ?").get(id);
  if (!x) throw bad("Story not found.", 404);
  const ev = await contentDb.prepare("SELECT kind, label FROM story_evidence WHERE story_id = ?").all(id);
  return { title: x.title || "Story", status: x.status, open: true,
    blocks: [{ title: "Story", rows: kv({ Type: storyWho(x), Status: x.status, Posted: ts(x.created_at), "Shown as": x.author_display, Anonymity: x.mode, "Employment verified": x.verified_employment ? "yes" : "no", Views: x.views, "Search engines": x.noindex ? "hidden" : "indexable", "Moderation note": x.mod_reason, Evidence: ev.map((e) => e.kind + (e.label ? `: ${e.label}` : "")).join(", ") }) }],
    text: { title: "Story text", body: [x.told && `Told: ${x.told}`, x.actual && `Actual: ${x.actual}`, x.body].filter(Boolean).join("\n\n") } };
};
ACT.stories = async function (staff, id, a, b) {
  const x = await contentDb.prepare("SELECT id, anonymous_id FROM stories WHERE id = ?").get(id);
  if (!x) throw bad("Story not found.", 404);
  if (a === "remove") { if (!b.reason) throw bad("A reason is required to remove a story."); await contentDb.prepare("UPDATE stories SET status='removed', mod_reason=?, moderated_by=?, moderated_at=? WHERE id=?").run(b.reason, staff.id, iso(), id); await notifyAuthor(x, `A story of yours was removed by moderators. Reason: ${cut(b.reason, 160)}. You can appeal from Settings.`); return; }
  if (a === "restore") { await contentDb.prepare("UPDATE stories SET status='published', mod_reason=NULL, moderated_by=?, moderated_at=? WHERE id=?").run(staff.id, iso(), id); return; }
  if (a === "noindex" || a === "index") { await contentDb.prepare("UPDATE stories SET noindex=? WHERE id=?").run(a === "noindex" ? 1 : 0, id); return; }
  if (a === "feature" || a === "unfeature") { await contentDb.prepare("UPDATE stories SET featured=? WHERE id=?").run(a === "feature" ? 1 : 0, id); await logStaff(staff, `story:${a}`, id); return; }
  if (a === "unpublish") {
    if (!b.reason) throw bad("A reason is required.");
    await contentDb.prepare("UPDATE stories SET status='draft', mod_reason=?, moderated_by=?, moderated_at=? WHERE id=?").run(b.reason, staff.id, iso(), id);
    await notifyAuthor(x, `A story of yours was moved back to draft by moderators. Reason: ${cut(b.reason, 160)}.`); await logStaff(staff, "story:unpublish", id, b.reason); return;
  }
  if (a === "edit") {
    if (!String(b.body || "").trim()) throw bad("The story text can't be empty.");
    if (!String(b.reason || "").trim()) throw bad("Say why you are editing it. It goes in the audit log.");
    await contentDb.prepare("UPDATE stories SET title=?, body=?, company_name=?, updated_at=?, moderated_by=?, moderated_at=? WHERE id=?").run(String(b.title || "").trim().slice(0, 160) || null, String(b.body).trim().slice(0, 20000), String(b.company_name || "").trim().slice(0, 120) || null, iso(), staff.id, iso(), id);
    await notifyAuthor(x, "A moderator edited one of your stories (for example to remove identifying details). Open it to see the change.");
    await logStaff(staff, "story:edit", id, b.reason); return;
  }
  if (a === "purge") {
    if (String(b.reason || "").trim() !== "DELETE") throw bad("Type DELETE to confirm.");
    await purgeStory(id); await logStaff(staff, "story:purge", id); return;
  }
  throw bad("Unknown action.");
};
// Permanent removal of a story and EVERYTHING attached to it, including private evidence files and view history.
async function purgeStory(id) {
  const ev = await contentDb.prepare("SELECT file_key FROM story_evidence WHERE story_id = ?").all(id);
  try { const { deletePrivateObject } = await import("@/lib/storage"); for (const e of ev) if (e.file_key) await deletePrivateObject(e.file_key).catch(() => {}); } catch { /* storage not configured */ }
  for (const t of ["story_me_too", "story_updates", "story_evidence", "story_follows", "company_responses", "story_disputes", "story_views"]) await contentDb.prepare(`DELETE FROM ${t} WHERE story_id = ?`).run(id).catch(() => {});
  try { const { deleteViewsFor } = await import("@/lib/views"); await deleteViewsFor("story", id); } catch {}
  await contentDb.prepare("DELETE FROM stories WHERE id = ?").run(id);
}
async function notifyAuthor(story, message) {
  try { const { resolveAliasAccountId, createNotification } = await import("@/lib/identity/service"); const acct = story.anonymous_id ? await resolveAliasAccountId(story.anonymous_id) : null; if (acct) await createNotification(acct, "moderation", message); } catch { /* best effort */ }
}

LIST.storydisputes = async function storydisputes() {
  const r = await contentDb.prepare(
    `SELECT d.*, s.title, s.body, s.company_name, s.status AS story_status FROM story_disputes d LEFT JOIN stories s ON s.id = d.story_id ORDER BY (d.status='open') DESC, d.created_at DESC LIMIT 200`
  ).all();
  return tbl([col("when", "Filed"), col("role", "Filed by"), col("reason", "Reason"), col("story", "Story"), col("status", "Status"), col("resolution", "Outcome")],
    r.map((x) => ({ id: x.id, when: x.created_at.slice(0, 16).replace("T", " "), role: { mentioned: "person mentioned", company: "company", other: "other" }[x.role] || x.role, reason: cut(x.reason, 100), story: cut(x.title || x.body || "(deleted)", 80), status: x.status, resolution: x.resolution || "" })),
    { actions: [
      { id: "dismissed", label: "Dismiss (no action)", input: { key: "reason", label: "Note to keep on record", optional: true } },
      { id: "removed", label: "Remove the story", danger: true, input: REASON },
      { id: "noindexed", label: "Keep it up, hide from search engines", input: { key: "reason", label: "Note", optional: true } },
      { id: "author_asked", label: "Ask the author to edit", input: { key: "reason", label: "What should they change? (they are notified)" } },
    ], pendingOnly: ["dismissed", "removed", "noindexed", "author_asked"], summary: [["Open", r.filter((x) => x.status === "open").length], ["From companies", r.filter((x) => x.role === "company" && x.status === "open").length]] });
};
DETAIL.storydisputes = async function (staff, id) {
  const d = await contentDb.prepare("SELECT * FROM story_disputes WHERE id = ?").get(id);
  if (!d) throw bad("Not found.", 404);
  const st = await contentDb.prepare("SELECT id, title, body, told, actual, company_name, author_display, status FROM stories WHERE id = ?").get(d.story_id);
  return { title: "Story report", status: d.status, open: d.status === "open",
    blocks: [{ title: "Report", rows: kv({ Filed: ts(d.created_at), "Filed by": d.role, Reason: d.reason, Details: d.details, Outcome: d.resolution }) }, { title: "Story", rows: kv({ Status: st?.status, Company: st?.company_name, "Shown as": st?.author_display, "Story id": d.story_id }) }],
    text: { title: "Reported story", body: st ? [st.title, st.told && `Told: ${st.told}`, st.actual && `Actual: ${st.actual}`, st.body].filter(Boolean).join("\n\n") : "(story deleted)" } };
};
ACT.storydisputes = async function (staff, id, a, b) {
  const d = await contentDb.prepare("SELECT * FROM story_disputes WHERE id = ? AND status = 'open'").get(id);
  if (!d) throw bad("Already handled.", 409);
  const story = await contentDb.prepare("SELECT id, anonymous_id FROM stories WHERE id = ?").get(d.story_id);
  if (a === "removed") { if (!b.reason) throw bad("A reason is required."); await ACT.stories(staff, d.story_id, "remove", b); }
  else if (a === "noindexed" && story) await contentDb.prepare("UPDATE stories SET noindex = 1 WHERE id = ?").run(story.id);
  else if (a === "author_asked") { if (!b.reason) throw bad("Say what the author should change."); if (story) await notifyAuthor(story, `A moderator asked you to edit a story: ${cut(b.reason, 220)}. Use “Add an update” on the story to correct it.`); }
  else if (a !== "dismissed") throw bad("Unknown action.");
  await contentDb.prepare("UPDATE story_disputes SET status='resolved', resolution=?, resolved_by=?, resolved_at=? WHERE id=?").run(`${a}${b.reason ? ": " + cut(b.reason, 120) : ""}`, staff.id, iso(), id);
};

LIST.circlesadmin = async function circlesadmin() {
  const r = await contentDb.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM circle_members m WHERE m.circle_id = c.id AND m.state IN ('active','muted')) members,
            (SELECT COUNT(*) FROM stories s WHERE s.circle_id = c.id AND s.status='published') stories FROM circles c ORDER BY (c.status='suspended') DESC, c.official DESC, members DESC LIMIT 300`
  ).all();
  return tbl([col("name", "Circle"), col("host", "Host"), col("members", "Members"), col("stories", "Stories"), col("mode", "Joining"), col("status", "Status")],
    r.map((c) => ({ id: c.id, name: c.name + (c.official ? " ★" : ""), host: c.official ? "LinkedOut" : (c.owner_display || "member"), members: +c.members, stories: +c.stories, mode: `${c.join_mode} · ${c.visibility}`, status: c.status })),
    { actions: [{ id: "suspend", label: "Suspend circle", danger: true, input: REASON }, { id: "restore", label: "Restore circle" }, { id: "feature", label: "Make official (★)" }, { id: "unfeature", label: "Remove official" }, { id: "delete", label: "Delete circle", danger: true, input: { key: "reason", label: "Type DELETE to confirm" } }],
      summary: [["Circles", r.length], ["Community-run", r.filter((c) => !c.official).length], ["Suspended", r.filter((c) => c.status === "suspended").length]] });
};
ACT.circlesadmin = async function (staff, id, a, b) {
  const c = await contentDb.prepare("SELECT id FROM circles WHERE id = ?").get(id);
  if (!c) throw bad("Not found.", 404);
  if (a === "suspend") { if (!b.reason) throw bad("A reason is required."); await contentDb.prepare("UPDATE circles SET status='suspended' WHERE id=?").run(id); }
  else if (a === "restore") await contentDb.prepare("UPDATE circles SET status='active' WHERE id=?").run(id);
  else if (a === "feature" || a === "unfeature") await contentDb.prepare("UPDATE circles SET official=? WHERE id=?").run(a === "feature" ? 1 : 0, id);
  else if (a === "delete") {
    if ((b.reason || "").trim() !== "DELETE") throw bad("Type DELETE (in capitals) to confirm.");
    await contentDb.prepare("UPDATE stories SET circle_id = NULL WHERE circle_id = ?").run(id);   // stories survive; they only leave the circle
    for (const t of ["circle_members", "circle_audit"]) await contentDb.prepare(`DELETE FROM ${t} WHERE circle_id = ?`).run(id);
    await contentDb.prepare("DELETE FROM circles WHERE id = ?").run(id);
  } else throw bad("Unknown action.");
  await contentDb.prepare("INSERT INTO circle_audit (id, circle_id, actor_key, action, note, created_at) VALUES (?,?,?,?,?,?)").run(uid(), id, `staff:${staff.id}`, `staff_${a}`, b.reason || null, iso()).catch(() => {});
};

LIST.employment = async function employment(staff) {
  const { storiesIdentityReady } = await import("@/lib/stories/identity-db");
  await storiesIdentityReady();
  const r = await identityDb.prepare("SELECT v.id, v.company_name, v.kind, v.method, v.status, v.email_domain, v.created_at, v.document_path, v.note, a.pseudonym FROM employment_verifications v LEFT JOIN accounts a ON a.id = v.account_id WHERE v.status <> 'expired' ORDER BY (v.status='pending' AND v.method='document') DESC, v.created_at DESC LIMIT 200").all();
  const actions = [{ id: "approved", label: "Approve", input: { key: "note", label: "Note (optional)", optional: true } }, { id: "rejected", label: "Reject", danger: true, input: REASON }];
  if (can(staff.role, "verification.docs")) actions.push({ id: "document", label: "View document" });
  return tbl([col("when", "Submitted"), col("user", "Account"), col("company", "Company"), col("kind", "Claims to be"), col("method", "Method"), col("status", "Status")],
    r.map((x) => ({ id: x.id, when: x.created_at.slice(0, 16).replace("T", " "), user: x.pseudonym, company: x.company_name, kind: x.kind, method: x.method === "work_email" ? `work email (${x.email_domain})${x.note === "review_domain:confirmed_address" ? " — confirm this domain belongs to the company" : ""}` : x.document_path ? "document" : "document (reviewed)", status: x.status })),
    { actions, pendingOnly: ["approved", "rejected", "document"], summary: [["Waiting for review", r.filter((x) => x.status === "pending" && (x.method === "document" || x.note === "review_domain:confirmed_address")).length], ["Verified", r.filter((x) => x.status === "verified").length]] });
};
ACT.employment = async function (staff, id, a, b) {
  const V = await import("@/lib/stories/verify");
  if (a === "document") { if (!(await identityDb.prepare("SELECT 1 x FROM employment_verifications WHERE id = ? AND document_path IS NOT NULL").get(id))) throw bad("No document attached; this one is a domain check."); await logStaff(staff, "view_employment_document", id); return { url: await V.documentUrl(id) }; }
  if (a === "rejected" && !b.reason) throw bad("A reason is required to reject.");
  await V.reviewDocument(id, a, staff.pseudonym || staff.id, b.note || b.reason || "");
};

LIST.publicrecords = async function publicrecords() {
  const r = await contentDb.prepare("SELECT * FROM public_records ORDER BY COALESCE(occurred_on, created_at) DESC LIMIT 300").all();
  return tbl([col("date", "Date"), col("company", "Company"), col("kind", "Kind"), col("headcount", "Roles"), col("summary", "Summary"), col("source", "Source")],
    r.map((x) => ({ id: x.id, date: x.occurred_on || x.created_at.slice(0, 10), company: x.company_key, kind: x.kind, headcount: x.headcount ?? "", summary: cut(x.summary, 100), source: `${x.source_name}` })),
    { actions: [{ id: "delete", label: "Delete record", danger: true, input: REASON }],
      create: [{ key: "companyName", label: "Company name (as on its LinkedOut page)" }, { key: "summary", label: "What was reported (one factual sentence)" }, { key: "sourceName", label: "Source (e.g. Reuters)" }, { key: "sourceUrl", label: "Link to the source (https://…)" }, { key: "occurredOn", label: "Date (YYYY-MM-DD)" }, { key: "headcount", label: "Roles affected (optional)" }], createLabel: "+ Add a publicly documented layoff",
      summary: [["Records", r.length]] });
};
CREATE.publicrecords = async (staff, body) => { const { addPublicRecord } = await import("@/lib/stories/service"); await addPublicRecord({ ...body, addedBy: staff.id }); };
ACT.publicrecords = async (staff, id, a) => { if (a !== "delete") throw bad("Unknown action."); await contentDb.prepare("DELETE FROM public_records WHERE id = ?").run(id); };

LIST.business = async function business() {
  const r = await contentDb.prepare("SELECT p.*, c.name FROM company_plans p LEFT JOIN companies c ON c.id = p.company_id ORDER BY (p.status='active') DESC, p.updated_at DESC LIMIT 300").all();
  const { BUSINESS_PLANS } = await import("@/lib/tiers");
  const mrr = r.filter((x) => x.status === "active").reduce((s, x) => s + ((x.billing_interval === "year" ? BUSINESS_PLANS[x.plan]?.annualMonthly : BUSINESS_PLANS[x.plan]?.monthly) || 0), 0);
  return tbl([col("company", "Company"), col("plan", "Plan"), col("interval", "Billing"), col("status", "Status"), col("renews", "Renews")],
    r.map((x) => ({ id: x.company_id, company: x.name || x.company_id.slice(0, 8), plan: x.plan, interval: x.billing_interval || "", status: x.status, renews: (x.current_period_end || "").slice(0, 10) })),
    { summary: [["Active business plans", r.filter((x) => x.status === "active").length], ["Business MRR (estimate)", "$" + mrr.toFixed(2)]], actions: [] });
};
LIST.leads = async function leads() {
  const { storiesIdentityReady } = await import("@/lib/stories/identity-db"); await storiesIdentityReady();
  const r = await identityDb.prepare("SELECT * FROM enterprise_leads ORDER BY (status='new') DESC, created_at DESC LIMIT 200").all();
  return tbl([col("when", "Received"), col("company", "Company"), col("contact", "Contact"), col("email", "Email"), col("size", "Team size"), col("msg", "Message"), col("status", "Status")],
    r.map((x) => ({ id: x.id, when: x.created_at.slice(0, 16).replace("T", " "), company: x.company_name, contact: x.contact_name || "", email: x.email, size: x.team_size || "", msg: cut(x.message, 80), status: x.status })),
    { actions: [{ id: "contacted", label: "Mark contacted" }, { id: "won", label: "Mark won" }, { id: "closed", label: "Close" }, { id: "delete", label: "Delete lead", danger: true, input: { key: "reason", label: "Type DELETE to permanently remove this lead." } }], summary: [["New", r.filter((x) => x.status === "new").length]] });
};
ACT.leads = async function (staff, id, a, b = {}) {
  if (a === "delete") { if (String(b.reason || "").trim() !== "DELETE") throw bad("Type DELETE to confirm."); const { identityDb: d0 } = await import("@/lib/stories/identity-db"); await d0.prepare("DELETE FROM enterprise_leads WHERE id = ?").run(id); await logStaff(staff, "lead:delete", id); return; }
  if (!["contacted", "won", "closed"].includes(a)) throw bad("Unknown action.");
  const { identityDb: db } = await import("@/lib/stories/identity-db");
  await db.prepare("UPDATE enterprise_leads SET status = ?, handled_by = ? WHERE id = ?").run(a, staff.id, id);
};

// ---------------- Company record (admin) ----------------
// Everything LinkedOut staff need about one company: verification, team, plan, reputation, content, risk, audit.
// Staff see the company's platform relationship, never who wrote a story, who submitted a salary or how anyone voted.
DETAIL.companies = async function (staff, id) {
  const c = await contentDb.prepare("SELECT * FROM companies WHERE id = ?").get(id);
  if (!c) throw bad("No such company.", 404);
  await logStaff(staff, "view_company", id);
  const q = (sql, ...p) => contentDb.prepare(sql).all(...p).catch(() => []);
  const one = (sql, ...p) => contentDb.prepare(sql).get(...p).catch(() => null);
  const { normCompany } = await import("@/lib/stories/service");
  const key = normCompany(c.name), since = (d) => new Date(Date.now() - d * 864e5).toISOString();
  const [plan, planHist, reps, docs, audit, stories, replies, disputes, reports, jobs, repAct, alertsN, faqN, annN, qN, interest, burst, authorStats] = await Promise.all([
    one("SELECT * FROM company_plans WHERE company_id = ?", id),
    q("SELECT plan, status, source, actor, created_at FROM company_plan_history WHERE company_id = ? ORDER BY created_at DESC LIMIT 20", id),
    q("SELECT anon_key, role, created_at FROM company_reps WHERE company_id = ? ORDER BY created_at", id),
    q("SELECT doc_type, filename, size_bytes, created_at FROM company_documents WHERE company_id = ? ORDER BY created_at DESC", id),
    q("SELECT actor, action, detail, created_at FROM company_audit WHERE company_id = ? ORDER BY created_at DESC LIMIT 120", id),
    q(`SELECT s.id, s.format, s.title, s.status, s.created_at, s.mod_reason, s.views, (SELECT COUNT(*) FROM content_reports r WHERE r.target_type = 'story' AND r.target_id = s.id) reports,
        (SELECT COUNT(*) FROM company_responses x WHERE x.story_id = s.id AND x.company_id = ?) replies FROM stories s WHERE s.company_id = ? OR s.company_key = ? ORDER BY s.created_at DESC LIMIT 60`, id, id, key),
    q("SELECT kind, COUNT(*) n, MAX(created_at) last FROM company_responses WHERE company_id = ? GROUP BY kind", id),
    q("SELECT d.reason, d.status, d.resolution, d.created_at FROM story_disputes d JOIN stories s ON s.id = d.story_id WHERE d.role = 'company' AND (s.company_id = ? OR s.company_key = ?) ORDER BY d.created_at DESC LIMIT 30", id, key),
    q("SELECT reason, status, resolution, created_at FROM content_reports WHERE target_type = 'company' AND target_id = ? ORDER BY created_at DESC LIMIT 30", id),
    q("SELECT id, title, created_at FROM jobs WHERE company_name ILIKE ? ORDER BY created_at DESC LIMIT 40", `%${String(c.name).replace(/[%_]/g, "")}%`),
    q("SELECT actor, MAX(created_at) last, COUNT(*) n FROM company_audit WHERE company_id = ? AND actor LIKE 'rep:%' GROUP BY actor", id),
    one("SELECT COUNT(*) n FROM company_alert_events WHERE company_id = ?", id),
    one("SELECT COUNT(*) n FROM company_faq WHERE company_id = ?", id),
    one("SELECT COUNT(*) n FROM company_announcements WHERE company_id = ?", id),
    one("SELECT COUNT(*) n FROM company_questions WHERE company_id = ? AND status = 'answered'", id),
    one("SELECT COUNT(*) n FROM company_interest WHERE company_id = ?", id),
    one("SELECT COUNT(*) n FROM stories WHERE (company_id = ? OR company_key = ?) AND created_at > ?", id, key, since(1)),
    one("SELECT COUNT(*) stories, COUNT(DISTINCT anonymous_id) authors FROM stories WHERE (company_id = ? OR company_key = ?) AND status = 'published' AND created_at > ?", id, key, since(30)),
  ]);
  const { planOf, repHandle } = await import("@/lib/stories/business");
  const p = await planOf(id);
  const { roleLabel } = await import("@/lib/company-roles");
  let rep = null, bench = null;
  try { const I = await import("@/lib/stories/company-intel"); const sig = await I.signals(c, { fresh: true }); rep = sig; if (c.industry) bench = await I.benchmarkFor(c); } catch { /* reputation is best effort */ }
  const openDisputes = disputes.filter((d) => d.status === "open").length, openReports = reports.filter((r) => r.status === "open").length;
  const risks = [];
  if (Number(burst?.n || 0) >= 10) risks.push(`${burst.n} stories in the last 24h (unusual burst)`);
  if (Number(authorStats?.stories || 0) >= 6 && Number(authorStats.authors) > 0 && authorStats.stories / authorStats.authors >= 2.5) risks.push(`High repeat posting: ${authorStats.stories} stories from ${authorStats.authors} distinct authors in 30 days`);
  if (openDisputes >= 3) risks.push(`${openDisputes} open factual disputes from the company`);
  if (openReports >= 3) risks.push(`${openReports} open user reports about this company`);
  if (reps.length > 8) risks.push(`${reps.length + 1} representatives is unusually many`);
  if (c.verification === "verified" && !c.domain_verified) risks.push("Verified by documents but domain not verified");
  const replyKind = (k) => Number(replies.find((x) => x.kind === k)?.n || 0);
  const actBy = Object.fromEntries(repAct.map((r) => [r.actor, r]));
  const blocks = [
    { title: "Company overview", rows: kv({ Name: c.name, Industry: c.industry, Status: c.status, Verification: c.verification, "Verification note": c.verification_note, "Domain verified": c.domain_verified ? "yes" : "no", "Verified at": ts(c.verified_at), Created: ts(c.created_at), "Account age (days)": Math.floor((Date.now() - new Date(c.created_at).getTime()) / 864e5), Description: cut(c.description, 200), ID: c.id }) },
    { title: "Subscription & billing", rows: kv({ Plan: p.plan, Status: p.status, Billing: p.interval, Renews: ts(p.renews), "Plan source": p.source === "admin_test" ? "STAFF TEST (no payment)" : p.source, "Stripe customer": plan?.stripe_customer_id, "Stripe subscription": plan?.stripe_subscription_id, Invoices: "In Stripe (linked by the subscription id)" }) },
    { title: "Reputation overview", rows: kv({ "Stories (365d, distinct reporters)": rep?.storyCount, "Reputation health": rep ? `${rep.health.label}${rep.health.score != null ? ` (${rep.health.score})` : ""}` : "n/a", "Response label": rep?.resp?.label, "Response rate (180d)": rep?.resp?.rate != null ? rep.resp.rate + "%" : "", "Median response (h)": rep?.resp?.medianHours, Trend: rep?.trend?.text }) },
    { title: "Industry benchmark (staff view)", rows: bench?.ready ? bench.metrics.filter((m) => m.available).map((m) => [m.label, `you ${m.you} · median ${m.median} · top10% ${m.top10} · p${m.percentile}`]) : [["Benchmark", bench?.note || "Needs an industry"]] },
    { title: "Company activity", rows: kv({ "Replies to stories": replyKind("reply"), "Company statements": replyKind("explanation"), "Last response": ts(replies.map((x) => x.last).sort().pop()), Announcements: Number(annN?.n || 0), "FAQ topics answered": Number(faqN?.n || 0), "Candidate questions answered": Number(qN?.n || 0), "Talent interest (aggregate)": Number(interest?.n || 0), "Alerts fired": Number(alertsN?.n || 0), Jobs: jobs.length }) },
    { title: "Company health / risk", rows: risks.length ? risks.map((r) => ["Signal", r]) : [["Signals", "None flagged"]] },
    { title: "Platform relationship", rows: kv({ "Open disputes from company": openDisputes, "Open reports about company": openReports, "Admin notes": audit.filter((a) => a.action === "staff_note").length, "Verification decisions": audit.filter((a) => ["verify", "reject", "verification_revoked"].includes(a.action)).length, "Priority review": p.perks.priorityReview ? "yes (Business Pro+)" : "no" }) },
  ];
  const tables = [
    { title: "Company representatives (handles only)", columns: ["Handle", "Role", "Joined", "Last activity", "Actions logged"], rows: [["owner", "Owner", ts(c.created_at), "", ""], ...reps.map((r) => { const h = repHandle(id, r.anon_key), a = actBy[`rep:${h}`]; return [h, roleLabel(r.role), ts(r.created_at), ts(a?.last), a?.n || 0]; })] },
    { title: "Verification documents", columns: ["Type", "File", "Size", "Uploaded"], rows: docs.map((d) => [d.doc_type, d.filename, d.size_bytes, ts(d.created_at)]) },
    { title: "Plan history", columns: ["When", "Plan", "Status", "Source", "By"], rows: planHist.map((h) => [ts(h.created_at), h.plan, h.status, h.source, h.actor]) },
    { title: "Stories about this company (authors never shown)", columns: ["Posted", "Format", "Title", "State", "Reports", "Replies", "Views", "Moderation"], rows: stories.map((x) => [ts(x.created_at), x.format, cut(x.title, 60), x.status, x.reports, x.replies, x.views, x.mod_reason || ""]) },
    { title: "Factual disputes from the company", columns: ["Filed", "Reason", "Status", "Outcome"], rows: disputes.map((d) => [ts(d.created_at), cut(d.reason, 80), d.status, cut(d.resolution, 60)]) },
    { title: "User reports and complaints about the company", columns: ["Filed", "Reason", "Status", "Outcome"], rows: reports.map((r) => [ts(r.created_at), cut(r.reason, 80), r.status, cut(r.resolution, 60)]) },
    { title: "Jobs", columns: ["Title", "Posted"], rows: jobs.map((j) => [j.title, ts(j.created_at)]) },
    { title: "Audit log (company and staff actions)", columns: ["When", "Who", "Action", "Detail"], rows: audit.map((a) => [ts(a.created_at), a.actor?.startsWith("staff:") ? `staff (${a.actor.slice(6)})` : a.actor, String(a.action).replace(/_/g, " "), cut(a.detail, 120)]) },
  ];
  return { title: c.name, status: `${c.status} · ${c.verification} · ${p.plan}`, blocks, tables, open: true };
};
