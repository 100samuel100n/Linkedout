// Runs once when the Next.js server starts. On a long-running host (Fly.io, Docker, VPS)
// this is the scheduler for admin push/email broadcasts: every minute it sends whatever is due.
// (Safe with several instances: each broadcast is claimed atomically in the database.)
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || globalThis.__loBroadcastTimer) return;
  globalThis.__loBroadcastTimer = setInterval(async () => {
    try { const { processDueBroadcasts } = await import("./lib/admin/broadcast.js"); await processDueBroadcasts(); }
    catch (e) { console.error("[broadcast scheduler]", e.message); }
  }, 60 * 1000);
  globalThis.__loBroadcastTimer.unref?.();
}
