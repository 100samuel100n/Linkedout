import { exportOwnStories, exportOwnStoriesFull, toCsv } from "@/lib/stories/analytics";
import { requireViewer, json, fail, planRequired } from "@/lib/stories/http";
import { getAnonymousIdsForAccount } from "@/lib/identity/service";
// Export your own stories (full text) or your story analytics. OUT PRO.  ?kind=stories|analytics  &format=csv|json
export async function GET(request) {
  const v = await requireViewer(); if (v.error) return v.error;
  if (!v.perks.exports) return planRequired("Exports", "OUT PRO");
  const sec = await import("@/lib/security/core");
  if (await sec.accountFlag(v.accountId, "no_downloads")) return json({ error: "Exports are temporarily disabled on your account for a security review. Contact support if this is a mistake." }, 403);
  sec.noteDownload(v.accountId, "stories export").catch(() => {});
  const u = new URL(request.url); const kind = u.searchParams.get("kind") === "analytics" ? "analytics" : "stories"; const fmt = u.searchParams.get("format") === "json" ? "json" : "csv";
  try {
    const keys = await getAnonymousIdsForAccount(v.accountId);
    const rows = kind === "analytics" ? await exportOwnStories(keys) : await exportOwnStoriesFull(keys);
    const dlp = await import("@/lib/security/dlp");
    if (fmt === "json") return new Response(JSON.stringify(await dlp.stamp(v.accountId, `export:${kind}`, { exportedAt: new Date().toISOString(), rows }), null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="linkedout-${kind}.json"` } });
    const cols = rows.length ? Object.keys(rows[0]) : [];
    return new Response(await dlp.stamp(v.accountId, `export:${kind}`, toCsv(cols, rows)), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="linkedout-${kind}.csv"` } });
  } catch (e) { return fail(e); }
}
