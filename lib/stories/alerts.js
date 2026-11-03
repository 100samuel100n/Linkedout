// Saved searches + alerts, story-tracking notifications, company alerts.
// Searches belong to an ACCOUNT (identity store). Matching reads a published story's public
// fields only, then notifies the account; the story's author is never exposed to the searcher.
import crypto from "node:crypto";
import { storiesIdentityReady, identityDb } from "./identity-db.js";
import { contentDb } from "../content/db.js";
import { createNotification, resolveAliasAccountId } from "../identity/service.js";
import { setAlertHook, normCompany, StoryError, followersOf } from "./service.js";
import { rowThemes } from "./themes.js";

const nowIso = () => new Date().toISOString();
const clip = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const COOLDOWN_MS = 10 * 60 * 1000;   // one alert per search per 10 minutes, so a busy topic can't flood anyone

export async function listSaved(accountId) {
  await storiesIdentityReady();
  return (await identityDb.prepare("SELECT id, label, query, alerts, created_at FROM saved_searches WHERE account_id = ? ORDER BY created_at DESC").all(accountId))
    .map((r) => ({ ...r, query: JSON.parse(r.query), alerts: !!r.alerts }));
}
export async function saveSearch(accountId, { label, query, alerts = true }, limit) {
  await storiesIdentityReady();
  if (!limit) throw new StoryError("Saved searches and alerts are part of OUT+.", 403, "PLAN_REQUIRED");
  const q = { q: clip(query?.q, 80), company: clip(query?.company, 80), category: clip(query?.category, 60), format: clip(query?.format, 30), theme: clip(query?.theme, 30) };
  if (!Object.values(q).some(Boolean)) throw new StoryError("Add a keyword, company, category or format to save a search.");
  const n = Number((await identityDb.prepare("SELECT COUNT(*) n FROM saved_searches WHERE account_id = ?").get(accountId)).n);
  if (n >= limit) throw new StoryError(`Your plan keeps ${limit} saved searches. Delete one or upgrade.`, 403, "PLAN_LIMIT");
  const id = crypto.randomUUID();
  await identityDb.prepare("INSERT INTO saved_searches (id, account_id, label, query, alerts, created_at) VALUES (?,?,?,?,?,?)")
    .run(id, accountId, clip(label, 60) || Object.values(q).filter(Boolean).join(" · "), JSON.stringify(q), alerts ? 1 : 0, nowIso());
  return { id };
}
export async function deleteSaved(accountId, id) { await storiesIdentityReady(); await identityDb.prepare("DELETE FROM saved_searches WHERE id = ? AND account_id = ?").run(id, accountId); return { ok: true }; }
export async function toggleSavedAlerts(accountId, id, on) { await storiesIdentityReady(); await identityDb.prepare("UPDATE saved_searches SET alerts = ? WHERE id = ? AND account_id = ?").run(on ? 1 : 0, id, accountId); return { ok: true }; }

const matches = (q, s) => {
  const hay = `${s.title || ""} ${s.body}`.toLowerCase();
  if (q.q && !hay.includes(q.q.toLowerCase())) return false;
  if (q.company && normCompany(q.company) !== s.company_key) return false;
  if (q.category && !JSON.parse(s.categories || "[]").includes(q.category)) return false;
  if (q.format && q.format !== s.format) return false;
  if (q.theme && !rowThemes(s).includes(q.theme)) return false;
  return true;
};

// Runs once per newly published Story (hooked into the service's afterPublish).
async function onPublished(storyId) {
  const s = await contentDb.prepare("SELECT * FROM stories WHERE id = ? AND status = 'published'").get(storyId);
  if (!s) return;
  const author = s.anonymous_id ? await resolveAliasAccountId(s.anonymous_id) : null;
  await storiesIdentityReady();
  const rows = await identityDb.prepare("SELECT id, account_id, label, query, last_alert_at FROM saved_searches WHERE alerts = 1 LIMIT 5000").all();
  const cutoff = new Date(Date.now() - COOLDOWN_MS).toISOString();
  const notified = new Set();
  for (const r of rows) {
    if (r.account_id === author || notified.has(r.account_id)) continue;
    if (r.last_alert_at && r.last_alert_at > cutoff) continue;
    if (!matches(JSON.parse(r.query), s)) continue;
    notified.add(r.account_id);
    await identityDb.prepare("UPDATE saved_searches SET last_alert_at = ? WHERE id = ?").run(nowIso(), r.id);
    await createNotification(r.account_id, "story_alert", `New story matching “${r.label}”${s.company_name ? ` · ${s.company_name}` : ""}`, null).catch(() => {});
  }
  // Company side. Every VERIFIED company hears about a new story (right of reply is free); companies on a plan also
  // get their configurable alert rules evaluated. Nobody is told who wrote the story.
  if (s.company_id) {
    const co = await contentDb.prepare("SELECT owner_key, verification FROM companies WHERE id = ? AND status = 'active'").get(s.company_id);
    if (co?.verification === "verified") {
      const acct = co.owner_key ? await resolveAliasAccountId(co.owner_key) : null;
      if (acct && acct !== author) await createNotification(acct, "company_alert", `A new story mentions ${s.company_name}. You can respond from your company page.`, null).catch(() => {});
      const { evaluateRules } = await import("./company-alerts.js");
      await evaluateRules(s.company_id, { storyId }).catch(() => {});
    }
  }
}
setAlertHook(onPublished);

// People who track a story hear about its updates (no one learns who tracks it).
export async function notifyFollowersOfUpdate(storyId, kind) {
  const keys = await followersOf(storyId);
  for (const k of keys) {
    const acct = await resolveAliasAccountId(k);
    if (acct) await createNotification(acct, "story_update", kind === "correction" ? "A story you track has a correction." : "A story you track has an update.", null).catch(() => {});
  }
}
