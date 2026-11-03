// Rate limiting, enforced at the identity layer — before any anonymous
// content token is issued, and before any reaction/vote is recorded. See
// architecture doc Section 5 ("Abuse & Brigading Prevention"). Counters are
// per accountId, which means the content service never needs to know about
// limits at all: by the time a request reaches lib/content/service.js, it
// has already passed this check.
import { bypassesGatesFor } from "../admin/bypass.js";
import crypto from "node:crypto";
import { identityDb } from "./db.js";

export class RateLimitError extends Error {
  constructor(message, retryAfterMs) {
    super(message);
    this.name = "RateLimitError";
    this.code = "RATE_LIMITED";
    this.retryAfterMs = retryAfterMs;
  }
}

// Deliberately conservative defaults. Tune per environment once there's
// real traffic data — these are starting points, not measured limits.
export const RATE_LIMITS = {
  post: { max: 5, windowMs: 10 * 60 * 1000, label: "posts" },
  react: { max: 30, windowMs: 60 * 1000, label: "reactions" },
  vote: { max: 20, windowMs: 24 * 60 * 60 * 1000, label: "award votes" },
  repost: { max: 20, windowMs: 10 * 60 * 1000, label: "reposts" },
  bookmark: { max: 60, windowMs: 60 * 1000, label: "bookmark changes" },
  room_create: { max: 3, windowMs: 60 * 60 * 1000, label: "Vent Rooms started" },
  room_action: { max: 60, windowMs: 60 * 1000, label: "room actions" },
  follow: { max: 40, windowMs: 60 * 60 * 1000, label: "follow changes" },
  company_create: { max: 2, windowMs: 24 * 60 * 60 * 1000, label: "company pages created" },
  company_edit: { max: 20, windowMs: 24 * 60 * 60 * 1000, label: "company page edits" },
  company_doc: { max: 10, windowMs: 24 * 60 * 60 * 1000, label: "document uploads" },
  company_manage: { max: 8, windowMs: 24 * 60 * 60 * 1000, label: "delete/restore actions" },
  company_report: { max: 6, windowMs: 24 * 60 * 60 * 1000, label: "reports" },
  action_code: { max: 4, windowMs: 60 * 60 * 1000, label: "confirmation codes" },
  domain_code: { max: 5, windowMs: 60 * 60 * 1000, label: "domain verification codes" },
  dm_send: { max: 60, windowMs: 60 * 1000, label: "messages" },
  dm_manage: { max: 60, windowMs: 60 * 60 * 1000, label: "conversation changes" },
  dm_report: { max: 10, windowMs: 24 * 60 * 60 * 1000, label: "message reports" },
  story_create: { max: 6, windowMs: 60 * 60 * 1000, label: "Stories" },
  story_react: { max: 60, windowMs: 60 * 1000, label: "Story reactions" },
  story_update: { max: 20, windowMs: 60 * 60 * 1000, label: "Story updates" },
  story_evidence: { max: 20, windowMs: 24 * 60 * 60 * 1000, label: "evidence uploads" },
  claim_create: { max: 6, windowMs: 24 * 60 * 60 * 1000, label: "company claims" },
  claim_check: { max: 30, windowMs: 24 * 60 * 60 * 1000, label: "Reality Checks" },
  story_dispute: { max: 6, windowMs: 24 * 60 * 60 * 1000, label: "story reports" },
  circle_create: { max: 3, windowMs: 24 * 60 * 60 * 1000, label: "circles started" },
  circle_manage: { max: 120, windowMs: 60 * 60 * 1000, label: "circle moderation actions" },
  emp_verify: { max: 12, windowMs: 60 * 60 * 1000, label: "employment verification attempts" },
  company_reply: { max: 30, windowMs: 24 * 60 * 60 * 1000, label: "company responses" },
};

// Per-tier daily caps for the two AI features. "Pro" is deliberately a
// real ceiling, not unlimited — heavy, repeated AI calls have a real
// per-request cost, and an uncapped tier is an open-ended cost/abuse
// surface regardless of price paid. These numbers are a considered
// starting point (translator: light, frequent, cheap-per-call, so a
// generous daily ceiling; resume roast: heavier and less useful to spam
// against the same resume repeatedly, so a lower one) — tune with real
// usage data once there's traffic to look at, same as RATE_LIMITS above.
export const TIERED_DAILY_LIMITS = {
  translate: { basic: 1, plus: 3, pro: 30, label: "Humble Brag Translator uses" },
  resume_roast: { basic: 0, plus: 3, pro: 10, label: "Resume Roast AI uses" },
  dm_request: { basic: 5, plus: 20, pro: 60, label: "message requests" },
  // Daily message ceiling (all chats). OUT and OUT+ share the standard cap; OUT PRO is raised.
  dm_daily: { basic: 200, plus: 200, pro: 1000, label: "messages" },
  ai_outreach: { basic: 0, plus: 0, pro: 20, label: "AI outreach drafts" },
  // Reality Translators (corporate / HR / meeting). Job-posting phrases use a free built-in glossary.
  speak_translate: { basic: 0, plus: 20, pro: 100, label: "Reality Translator uses" },
  story_assist: { basic: 0, plus: 10, pro: 50, label: "AI Story Assistant uses" },
  story_summary: { basic: 0, plus: 15, pro: 60, label: "AI summaries" },
  deep_dive: { basic: 0, plus: 0, pro: 30, label: "Company Deep Dives and Pattern Explorer questions" },
};

// Counting and recording are done insert-first: the event row is written,
// THEN the window is counted. Two requests racing each other both see each
// other's row, so a burst of parallel requests can never slip past the cap
// the way a read-then-write check would let it. An over-limit request
// removes its own row again so rejected attempts don't extend the lockout.
async function claimSlot({ accountId, action, max, windowMs, message }) {
  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  await identityDb.prepare(
    "INSERT INTO rate_limit_events (id, account_id, action, created_at) VALUES (?, ?, ?, ?)"
  ).run(id, accountId, action, nowIso);

  const windowStartIso = new Date(Date.now() - windowMs).toISOString();
  const { count } = await identityDb.prepare(
    "SELECT COUNT(*) AS count FROM rate_limit_events WHERE account_id = ? AND action = ? AND created_at > ?"
  ).get(accountId, action, windowStartIso);
  const used = Number(count);

  if (used > max) {
    await identityDb.prepare("DELETE FROM rate_limit_events WHERE id = ?").run(id);
    const oldest = await identityDb.prepare(
      `SELECT created_at FROM rate_limit_events
       WHERE account_id = ? AND action = ? AND created_at > ?
       ORDER BY created_at ASC LIMIT 1`
    ).get(accountId, action, windowStartIso);
    const retryAfterMs = Math.max(1000, oldest ? new Date(oldest.created_at).getTime() + windowMs - Date.now() : windowMs);
    import("../security/core.js").then((m) => m.noteRateLimit(action, accountId)).catch(() => {});
    throw new RateLimitError(message(Math.ceil(retryAfterMs / 1000)), retryAfterMs);
  }
  return { remaining: Math.max(0, max - used) };
}

export async function checkTieredRateLimit(accountId, action, tier) {
  if (await bypassesGatesFor(accountId)) return { remaining: Infinity };
  const rule = TIERED_DAILY_LIMITS[action];
  if (!rule) throw new Error(`Unknown tiered rate limit action: "${action}"`);
  const max = rule[tier] ?? rule.basic;
  const upgradeHint = tier === "pro" ? "" : tier === "plus" ? " Upgrade to OUT PRO for more." : " Upgrade to OUT+ or OUT PRO for more.";
  return claimSlot({
    accountId, action, max, windowMs: 24 * 60 * 60 * 1000,
    message: () => `You've reached today's limit for ${rule.label} on your current plan.${upgradeHint}`,
  });
}

// Rolling window, not a fixed bucket that resets on the clock — "5 posts
// per 10 minutes" always looks back exactly 10 minutes from now, so it
// can't be gamed by timing requests around a reset boundary.
export async function checkRateLimit(accountId, action) {
  if (await bypassesGatesFor(accountId)) return { remaining: Infinity };
  const rule = RATE_LIMITS[action];
  if (!rule) throw new Error(`Unknown rate limit action: "${action}"`);
  return claimSlot({
    accountId, action, max: rule.max, windowMs: rule.windowMs,
    message: (secs) => `Too many ${rule.label} — limit is ${rule.max} per ${Math.round(rule.windowMs / 60000)} min. Try again in ${secs}s.`,
  });
}

// Per-target limit: caps how often ONE account may act on ONE thing (e.g.
// repost/unrepost the same post). This is what stops rapid on/off flapping
// of a single post even while the account's overall budget is fine.
export async function checkTargetRateLimit(accountId, action, targetId, { max, windowMs, label }) {
  if (await bypassesGatesFor(accountId)) return { remaining: Infinity };
  return claimSlot({
    accountId, action: `${action}:${targetId}`, max, windowMs,
    message: (secs) => `You're doing that too fast — try ${label || "again"} in ${secs}s.`,
  });
}

// Limits that aren't tied to a logged-in account: keyed by IP hash, email,
// phone hash, etc. Same insert-first mechanics.
export async function checkKeyedRateLimit(key, action, { max, windowMs, label = "requests" }) {
  const id = crypto.randomUUID();
  await identityDb.prepare("INSERT INTO throttle_events (id, throttle_key, action, created_at) VALUES (?, ?, ?, ?)")
    .run(id, key, action, new Date().toISOString());
  const since = new Date(Date.now() - windowMs).toISOString();
  const { count } = await identityDb.prepare(
    "SELECT COUNT(*) AS count FROM throttle_events WHERE throttle_key = ? AND action = ? AND created_at > ?"
  ).get(key, action, since);
  if (Number(count) > max) {
    await identityDb.prepare("DELETE FROM throttle_events WHERE id = ?").run(id);
    import("../security/core.js").then((m) => m.noteRateLimit(action, key)).catch(() => {});
    throw new RateLimitError(`Too many ${label}. Please wait a few minutes and try again.`, windowMs);
  }
}

// Housekeeping — old rows are only ever relevant within their own window,
// so they can be purged well past that. Not called automatically; wire
// into a cron/scheduled task in a real deployment. Safe to run any time.
export async function pruneOldRateLimitEvents(olderThanMs = 7 * 24 * 60 * 60 * 1000) {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  await identityDb.prepare("DELETE FROM rate_limit_events WHERE created_at < ?").run(cutoff);
  await identityDb.prepare("DELETE FROM throttle_events WHERE created_at < ?").run(cutoff);
}
