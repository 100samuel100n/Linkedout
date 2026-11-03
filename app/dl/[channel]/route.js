import { NextResponse } from "next/server";
import { identityDb } from "@/lib/identity/db";
import { distReady, logEvent, settings } from "@/lib/distribution/db";
import { latestFor } from "@/lib/distribution/manifest";
import { ctx } from "@/lib/distribution/http";

// Counted download links:  /dl/apk  (also /dl/LinkedOut.apk)  ·  /dl/<channel-id>  ·  /dl/obtainium, /dl/fdroid …
//
// The APK is STREAMED THROUGH THIS SERVER with the headers Android needs:
//   Content-Type: application/vnd.android.package-archive   -> phone offers the package installer, not "open with a file app"
//   Content-Disposition: attachment; filename="LinkedOut-<version>.apk" -> short, clean file name
// Storage/CDN links (EAS artifact URLs, plain buckets) often send application/octet-stream, which is what produced the file picker.
// Set DIST_DL_MODE=redirect to send people to the storage URL instead (only if that storage sets the right headers itself).
export const dynamic = "force-dynamic";
const APK_TYPE = "application/vnd.android.package-archive";

async function sendApk(request, rel) {
  const range = request.headers.get("range");
  let up; try { up = await fetch(rel.url, { redirect: "follow", headers: range ? { Range: range } : {} }); } catch { return null; }
  if (!up.ok && up.status !== 206) return null;
  const h = new Headers({ "Content-Type": APK_TYPE, "Content-Disposition": `attachment; filename="LinkedOut-${String(rel.version_name).replace(/[^\w.-]/g, "")}.apk"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes" });
  for (const k of ["content-length", "content-range"]) if (up.headers.get(k)) h.set(k, up.headers.get(k));
  return new Response(up.body, { status: up.status, headers: h });
}

export async function GET(request, { params }) {
  const { channel } = await params; const { ip, country } = ctx(request); await distReady();
  const site = (process.env.NEXT_PUBLIC_APP_URL || "http://linkedoutnetwork.com").replace(/\/$/, "");
  try {
    // APK downloads switched off in Admin: nothing here serves; people are sent to the web-app install page.
    if ((await settings()).apk_enabled !== "1") return NextResponse.redirect(`${site}/install`, 302);
    if (channel === "apk" || channel.toLowerCase().endsWith(".apk")) {
      const rel = await latestFor(null); if (!rel) return NextResponse.redirect(`${site}/install?soon=1`, 302);
      if (!request.headers.get("range")) await logEvent("download", { channel: "website", versionCode: rel.version_code, ip, country });   // count the download once, not every resumed chunk
      if (String(process.env.DIST_DL_MODE || "").toLowerCase() !== "redirect") { const res = await sendApk(request, rel); if (res) return res; }
      return NextResponse.redirect(rel.url, 302, { headers: { "Cache-Control": "no-store" } });
    }
    const c = await identityDb.prepare("SELECT id, url FROM dist_channels WHERE id = ? AND enabled = 1").get(channel) || await identityDb.prepare("SELECT id, url FROM dist_channels WHERE kind = ? AND enabled = 1 ORDER BY sort LIMIT 1").get(String(channel).slice(0, 20));
    if (!c) return NextResponse.redirect(`${site}/install`, 302);
    await logEvent("download", { channel: c.id, ip, country });
    return NextResponse.redirect(c.url, 302);
  } catch { return NextResponse.redirect(`${site}/install`, 302); }
}