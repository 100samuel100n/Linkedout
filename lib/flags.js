// Runtime feature switches that must be flippable without a redeploy.
//
// JOBS_ENABLED
//   * Environment variable JOBS_ENABLED=false  -> hard OFF for the whole deployment (cannot be overridden from the dashboard).
//   * Otherwise the admin switch decides: Admin -> Feed Controls -> "Jobs (web and app)" (stored as feed_settings.jobs_enabled).
//   * Default: ON.
// Web pages, the web nav, every /api/jobs/* route, the job cron and the native app all read this one function.
import { NextResponse } from "next/server";
import { contentDb } from "@/lib/content/db";

let cache = { at: 0, v: true };
export async function jobsEnabled() {
  if (String(process.env.JOBS_ENABLED || "").toLowerCase() === "false") return false;
  if (Date.now() - cache.at < 5000) return cache.v;
  try {
    const r = await contentDb.prepare("SELECT value FROM feed_settings WHERE key = 'jobs_enabled'").get();
    cache = { at: Date.now(), v: r ? r.value !== "0" : true };
  } catch { cache = { at: Date.now(), v: true }; }
  return cache.v;
}
export const jobsLockedByEnv = () => String(process.env.JOBS_ENABLED || "").toLowerCase() === "false";
export function resetFlagCache() { cache.at = 0; }
// Standard response for a paused section.
export const JOBS_PAUSED_BODY = { error: "Jobs is paused for now. Everything else is working as usual.", code: "JOBS_PAUSED" };

// Wrap a route handler: while Jobs is paused it answers 503 { code: "JOBS_PAUSED" } and does no work.
export const pausable = (handler) => async (...args) => (await jobsEnabled() ? handler(...args) : NextResponse.json(JOBS_PAUSED_BODY, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "600" } }));
