// Support Circles: small anonymous communities by experience. Anyone can join; OUT+ members can
// start one, OUT PRO members can run several. Members are only ever known by alias key.
//
// Roles: owner (one) > mod > member.   States: active | pending (awaiting approval) | muted | banned.
// Owners and mods manage; staff can suspend / restore / delete any circle from the admin dashboard.
import crypto from "node:crypto";
import { contentDb, formatRelativeTime } from "../content/db.js";
import { redactFields } from "./redact.js";
import { StoryError, ensureCircles, listStories } from "./service.js";

const nowIso = () => new Date().toISOString();
const clip = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const slugify = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
const audit = (circleId, actor, action, target, note) =>
  contentDb.prepare("INSERT INTO circle_audit (id, circle_id, actor_key, action, target, note, created_at) VALUES (?,?,?,?,?,?,?)").run(crypto.randomUUID(), circleId, actor || null, action, target || null, note || null, nowIso());

async function membership(circleId, key) {
  if (!key) return null;
  return contentDb.prepare("SELECT role, state FROM circle_members WHERE circle_id = ? AND anon_key = ?").get(circleId, key) || null;
}
const isManager = (m) => !!m && m.state === "active" && (m.role === "owner" || m.role === "mod");

export async function circleBySlug(slug) {
  await ensureCircles();
  return contentDb.prepare("SELECT * FROM circles WHERE slug = ?").get(slug);
}

function shape(c, m, counts = {}) {
  return {
    id: c.id, slug: c.slug, name: c.name, description: c.description, rules: c.rules || null,
    joinMode: c.join_mode, visibility: c.visibility, status: c.status, official: !!c.official,
    host: c.owner_display || (c.official ? "LinkedOut" : null), memberCap: c.member_cap || null,
    members: counts.members ?? 0, stories: counts.stories ?? 0, pending: counts.pending ?? 0,
    me: m ? { role: m.role, state: m.state } : null, canManage: isManager(m), isOwner: !!m && m.role === "owner" && m.state === "active",
  };
}
async function counts(c) {
  const [m, s, p] = await Promise.all([
    contentDb.prepare("SELECT COUNT(*) n FROM circle_members WHERE circle_id = ? AND state IN ('active','muted')").get(c.id),
    contentDb.prepare("SELECT COUNT(*) n FROM stories WHERE circle_id = ? AND status = 'published'").get(c.id),
    contentDb.prepare("SELECT COUNT(*) n FROM circle_members WHERE circle_id = ? AND state = 'pending'").get(c.id),
  ]);
  return { members: Number(m.n), stories: Number(s.n), pending: Number(p.n) };
}

export async function listCircles(viewerKey, { mineOnly = false } = {}) {
  await ensureCircles();
  const rows = await contentDb.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM circle_members m WHERE m.circle_id = c.id AND m.state IN ('active','muted')) AS members,
            (SELECT COUNT(*) FROM stories s WHERE s.circle_id = c.id AND s.status = 'published') AS stories
     FROM circles c WHERE c.status = 'active' AND (c.visibility = 'public' OR c.owner_key = ? OR EXISTS (SELECT 1 FROM circle_members x WHERE x.circle_id = c.id AND x.anon_key = ?))
     ORDER BY c.official DESC, members DESC, c.name`
  ).all(viewerKey || "", viewerKey || "");
  const mine = new Map(viewerKey ? (await contentDb.prepare("SELECT circle_id, role, state FROM circle_members WHERE anon_key = ?").all(viewerKey)).map((r) => [r.circle_id, r]) : []);
  const out = rows.map((c) => shape(c, mine.get(c.id), { members: Number(c.members), stories: Number(c.stories) }));
  return mineOnly ? out.filter((c) => c.me) : out;
}

export async function getCircle(slug, viewerKey) {
  const c = await circleBySlug(slug);
  if (!c || (c.status === "suspended" && c.owner_key !== viewerKey)) return null;
  const m = await membership(c.id, viewerKey);
  if (c.visibility === "unlisted" && !m && c.owner_key !== viewerKey) { /* reachable by link, shown without member-only details */ }
  const out = shape(c, m, await counts(c));
  out.unreadStatus = c.status;
  return out;
}

export async function circleStories(slug, viewerKey, params = {}) {
  const c = await circleBySlug(slug);
  if (!c || c.status === "suspended") return [];
  return listStories({ viewerKey, circle: slug, before: params.before || null, limit: params.limit || 20, sort: params.sort || "recent" });
}

// ---- create (tier-gated) -----------------------------------------------------------------
export async function createCircle({ name, description, rules, joinMode, visibility }, identity, perks) {
  if (!perks.circlesCreate) throw new StoryError("Starting a Circle is part of OUT+.", 403, "PLAN_REQUIRED");
  const owned = Number((await contentDb.prepare("SELECT COUNT(*) n FROM circles WHERE owner_key = ? AND status <> 'archived'").get(identity.anonymousId)).n);
  if (owned >= perks.circlesCreate) throw new StoryError(`Your plan lets you run ${perks.circlesCreate} circle${perks.circlesCreate === 1 ? "" : "s"}. Archive one or upgrade.`, 403, "PLAN_LIMIT");
  const { values } = redactFields({ name: clip(name, 60), description: clip(description, 400), rules: clip(rules, 1500) });
  if (values.name.length < 3) throw new StoryError("Give the circle a name (at least 3 characters).");
  if (values.description.length < 20) throw new StoryError("Say who the circle is for in a sentence or two.");
  let slug = slugify(values.name) || "circle"; const base = slug;
  for (let i = 2; await contentDb.prepare("SELECT 1 x FROM circles WHERE slug = ?").get(slug); i++) slug = `${base}-${i}`;
  const id = crypto.randomUUID();
  await contentDb.prepare(
    `INSERT INTO circles (id, slug, name, description, created_at, owner_key, owner_display, join_mode, visibility, rules, status, member_cap)
     VALUES (?,?,?,?,?,?,?,?,?,?, 'active', ?)`
  ).run(id, slug, values.name, values.description, nowIso(), identity.anonymousId, identity.displayLabel,
    joinMode === "request" ? "request" : "open", visibility === "unlisted" && perks.exports ? "unlisted" : "public", values.rules || null, perks.circleMembersMax);
  await contentDb.prepare("INSERT INTO circle_members (circle_id, anon_key, created_at, role, state) VALUES (?,?,?, 'owner', 'active')").run(id, identity.anonymousId, nowIso());
  await audit(id, identity.anonymousId, "created", null, values.name);
  return { slug };
}

// ---- membership ---------------------------------------------------------------------------
export async function joinCircle(slug, key) {
  const c = await circleBySlug(slug);
  if (!c || c.status !== "active") throw new StoryError("Circle not found.", 404, "NOT_FOUND");
  const m = await membership(c.id, key);
  if (m?.state === "banned") throw new StoryError("You can't join this circle.", 403, "BANNED");
  if (m?.state === "active" || m?.state === "muted") return { state: "active" };
  if (m?.state === "pending") return { state: "pending" };
  if (c.member_cap) { const n = Number((await contentDb.prepare("SELECT COUNT(*) n FROM circle_members WHERE circle_id = ? AND state IN ('active','muted')").get(c.id)).n); if (n >= c.member_cap) throw new StoryError("This circle is full.", 403, "FULL"); }
  const state = c.join_mode === "request" ? "pending" : "active";
  await contentDb.prepare("INSERT INTO circle_members (circle_id, anon_key, created_at, role, state) VALUES (?,?,?, 'member', ?) ON CONFLICT (circle_id, anon_key) DO UPDATE SET state = EXCLUDED.state").run(c.id, key, nowIso(), state);
  return { state };
}
export async function leaveCircle(slug, key) {
  const c = await circleBySlug(slug); if (!c) throw new StoryError("Circle not found.", 404, "NOT_FOUND");
  const m = await membership(c.id, key);
  if (m?.role === "owner") throw new StoryError("Hand the circle to a moderator or archive it before leaving.", 400, "OWNER");
  if (m?.state === "banned") return { ok: true };       // a ban must not be escapable by leave + rejoin
  await contentDb.prepare("DELETE FROM circle_members WHERE circle_id = ? AND anon_key = ?").run(c.id, key);
  return { ok: true };
}

// ---- management (owner / mods) ------------------------------------------------------------
async function managed(slug, key, { ownerOnly = false } = {}) {
  const c = await circleBySlug(slug); if (!c) throw new StoryError("Circle not found.", 404, "NOT_FOUND");
  const m = await membership(c.id, key);
  if (!isManager(m) || (ownerOnly && m.role !== "owner")) throw new StoryError(ownerOnly ? "Only the circle's owner can do that." : "Only the circle's moderators can do that.", 403, "NOT_MANAGER");
  return { c, m };
}

export async function manageOverview(slug, key) {
  const { c, m } = await managed(slug, key);
  const members = await contentDb.prepare(
    `SELECT cm.anon_key, cm.role, cm.state, cm.created_at FROM circle_members cm
     WHERE cm.circle_id = ? ORDER BY (cm.state='pending') DESC, cm.role, cm.created_at LIMIT 300`
  ).all(c.id);
  const log = await contentDb.prepare("SELECT action, target, note, created_at FROM circle_audit WHERE circle_id = ? ORDER BY created_at DESC LIMIT 40").all(c.id);
  const recent = await contentDb.prepare("SELECT id, title, body, author_display, created_at FROM stories WHERE circle_id = ? AND status = 'published' ORDER BY created_at DESC LIMIT 30").all(c.id);
  // Members are shown as stable short handles, never alias display names, so mods can act without unmasking anyone.
  const handle = (k) => `member-${crypto.createHash("sha256").update(`${c.id}:${k}`).digest("hex").slice(0, 6)}`;
  return {
    circle: shape(c, m, await counts(c)),
    members: members.map((x) => ({ handle: handle(x.anon_key), ref: x.anon_key === key ? "you" : handle(x.anon_key), role: x.role, state: x.state, joined: formatRelativeTime(x.created_at), you: x.anon_key === key })),
    handles: Object.fromEntries(members.map((x) => [handle(x.anon_key), x.anon_key === key ? null : true])),
    log: log.map((l) => ({ ...l, time: formatRelativeTime(l.created_at) })),
    stories: recent.map((s) => ({ id: s.id, title: s.title || s.body.slice(0, 80), author: s.author_display, time: formatRelativeTime(s.created_at) })),
  };
}

async function keyFromHandle(c, handle) {
  const rows = await contentDb.prepare("SELECT anon_key FROM circle_members WHERE circle_id = ?").all(c.id);
  return rows.map((r) => r.anon_key).find((k) => `member-${crypto.createHash("sha256").update(`${c.id}:${k}`).digest("hex").slice(0, 6)}` === handle);
}

export async function manageAction(slug, key, { action, handle, note, storyId, patch }) {
  const { c, m } = await managed(slug, key, { ownerOnly: ["archive", "restore", "transfer", "mod", "unmod"].includes(action) });
  const touch = async (fn) => { const target = await keyFromHandle(c, handle); if (!target) throw new StoryError("That member isn't in this circle.", 404, "NOT_FOUND"); if (target === key) throw new StoryError("You can't do that to yourself.", 400, "SELF"); const t = await membership(c.id, target); if (t.role === "owner" || (t.role === "mod" && m.role !== "owner")) throw new StoryError("Only the owner can act on a moderator.", 403, "NOT_ALLOWED"); await fn(target, t); };
  const setState = (state) => touch((target) => contentDb.prepare("UPDATE circle_members SET state = ? WHERE circle_id = ? AND anon_key = ?").run(state, c.id, target));
  switch (action) {
    case "approve": await setState("active"); break;
    case "deny": await touch((t) => contentDb.prepare("DELETE FROM circle_members WHERE circle_id = ? AND anon_key = ?").run(c.id, t)); break;
    case "mute": await setState("muted"); break;
    case "unmute": await setState("active"); break;
    case "ban": await setState("banned"); break;
    case "unban": await touch((t) => contentDb.prepare("DELETE FROM circle_members WHERE circle_id = ? AND anon_key = ?").run(c.id, t)); break;
    case "remove": await touch((t) => contentDb.prepare("DELETE FROM circle_members WHERE circle_id = ? AND anon_key = ?").run(c.id, t)); break;
    case "mod": await touch((t) => contentDb.prepare("UPDATE circle_members SET role = 'mod' WHERE circle_id = ? AND anon_key = ?").run(c.id, t)); break;
    case "unmod": await touch((t) => contentDb.prepare("UPDATE circle_members SET role = 'member' WHERE circle_id = ? AND anon_key = ?").run(c.id, t)); break;
    case "transfer": await touch(async (t) => {
      await contentDb.prepare("UPDATE circle_members SET role = 'owner' WHERE circle_id = ? AND anon_key = ?").run(c.id, t);
      await contentDb.prepare("UPDATE circle_members SET role = 'mod' WHERE circle_id = ? AND anon_key = ?").run(c.id, key);
      await contentDb.prepare("UPDATE circles SET owner_key = ?, owner_display = NULL WHERE id = ?").run(t, c.id);
    }); break;
    case "remove_story": {
      const n = await contentDb.prepare("UPDATE stories SET circle_id = NULL WHERE id = ? AND circle_id = ?").run(storyId, c.id);
      if (!n.changes) throw new StoryError("That story isn't in this circle.", 404, "NOT_FOUND"); break;   // the story itself stays live; it only leaves the circle
    }
    case "update": {
      const { values } = redactFields({ description: clip(patch?.description, 400), rules: clip(patch?.rules, 1500) });
      await contentDb.prepare("UPDATE circles SET description = COALESCE(NULLIF(?, ''), description), rules = ?, join_mode = ? WHERE id = ?")
        .run(values.description, values.rules || null, patch?.joinMode === "request" ? "request" : "open", c.id); break;
    }
    case "archive": await contentDb.prepare("UPDATE circles SET status = 'archived' WHERE id = ?").run(c.id); break;
    case "restore": await contentDb.prepare("UPDATE circles SET status = 'active' WHERE id = ? AND status = 'archived'").run(c.id); break;
    default: throw new StoryError("Unknown action.");
  }
  await audit(c.id, key, action, handle || storyId || null, clip(note, 200));
  return manageOverview(slug, key);
}

// Posting into a circle: members only, not banned/muted, circle must be active.
export async function assertCanPostInCircle(slug, key) {
  const c = await circleBySlug(slug);
  if (!c || c.status !== "active") throw new StoryError("That circle isn't accepting stories.", 400, "CIRCLE_CLOSED");
  const m = await membership(c.id, key);
  if (!m || m.state !== "active") throw new StoryError("Join the circle before sharing a story in it.", 403, "NOT_MEMBER");
  return c;
}

export async function managerCircleId(slug, key) {
  const c = await circleBySlug(slug); if (!c) return null;
  return isManager(await membership(c.id, key)) ? c.id : null;
}
