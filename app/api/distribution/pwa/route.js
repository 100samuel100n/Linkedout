import { NextResponse } from "next/server";
import { logEvent, settings } from "@/lib/distribution/db";
import { recordPwa } from "@/lib/distribution/pwa";
import { getCurrentAccountId } from "@/lib/session";
import { fail, ctx } from "@/lib/distribution/http";
import { throttle } from "@/lib/identity/throttle-http";
// Web-app telemetry. "install" = first time the home-screen / installed app is opened in standalone mode (iPhone has no install event);
// "open" = at most once a day. `d` is a random id kept on the device, never an account id. The signed-in account (if any) is linked
// server-side from the session cookie so admins can see who is behind a device and respond (flag, sign out, block).
export async function POST(request) {
  try {
    if ((await settings()).pwa_enabled !== "1") return NextResponse.json({ ok: true });
    const limited = await throttle(request, [["ip", null, "dist_pwa", { max: 300, windowMs: 3600000, label: "requests" }]]); if (limited) return limited;
    const b = await request.json().catch(() => ({})); const kind = b.kind === "install" ? "pwa_install" : b.kind === "check" ? "pwa_check" : "pwa_open"; const d = String(b.d || "").slice(0, 40);
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(d)) return NextResponse.json({ ok: true });
    const { ip, country } = ctx(request); const accountId = await getCurrentAccountId().catch(() => null);
    if (kind !== "pwa_check") await logEvent(kind, { device: d, channel: String(b.platform || "").slice(0, 16), ip, country });
    const r = await recordPwa({ d, kind, ua: request.headers.get("user-agent") || "", ip, country, accountId, info: { w: b.w, h: b.h, dpr: b.dpr, lang: b.lang, tz: b.tz, display: b.display, build: b.build }, headers: request.headers, precise: b.precise });
    return NextResponse.json({ ok: true, signOut: r.signOut, status: r.status, kill: r.kill, reason: r.reason });
  } catch (e) { return fail(e); }
}