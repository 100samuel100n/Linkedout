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
  // Distribution integrity: flush per-install counters and run detections (abnormal usage, scheduled look-alike scans). Every minute; cheap.
  if (!globalThis.__loDistTimer) {
    globalThis.__loDistTimer = setInterval(async () => {
      try { const { sweep } = await import("./lib/distribution/detect.js"); await sweep(); }
      catch (e) { console.error("[distribution sweep]", e.message); }
    }, 60 * 1000);
    globalThis.__loDistTimer.unref?.();
  }
  // Scheduled company reports and job housekeeping: hourly. Each due item is claimed atomically, so several instances are safe.
  if (!globalThis.__loCompanyTimer) {
    globalThis.__loCompanyTimer = setInterval(async () => {
      try { const { runDueReports } = await import("./lib/stories/company-extras.js"); await runDueReports(); const { runJobMaintenance } = await import("./lib/jobs/maintenance.js"); await runJobMaintenance(); }
      catch (e) { console.error("[company scheduler]", e.message); }
    }, 60 * 60 * 1000);
    globalThis.__loCompanyTimer.unref?.();
  }
}
