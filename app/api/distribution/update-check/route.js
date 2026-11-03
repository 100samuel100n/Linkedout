import { NextResponse } from "next/server";
import { buildUpdateResponse } from "@/lib/distribution/manifest";
import { logEvent } from "@/lib/distribution/db";
import { fail, ctx, NOSTORE } from "@/lib/distribution/http";
import { throttle } from "@/lib/identity/throttle-http";
// GET ?code=<versionCode>&channel=<where it was installed from>&install=<installId>   -> signed answer
export async function GET(request) {
  try {
    const limited = await throttle(request, [["ip", null, "dist_update", { max: 120, windowMs: 3600000, label: "update checks" }]]); if (limited) return limited;
    const u = new URL(request.url); const versionCode = +u.searchParams.get("code") || 0, install = (u.searchParams.get("install") || "").slice(0, 40), channel = (u.searchParams.get("channel") || "").slice(0, 24);
    const { ip, country } = ctx(request); logEvent("update_check", { versionCode, installId: install || null, channel, ip, country }).catch(() => {});
    return NextResponse.json(await buildUpdateResponse({ versionCode, installId: install, channel }), { headers: NOSTORE });
  } catch (e) { return fail(e); }
}
