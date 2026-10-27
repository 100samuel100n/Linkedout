import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { heartbeat, goOffline } from "@/lib/admin/presence";
import { resolveGeo } from "@/lib/geo";
import { throttle } from "@/lib/identity/throttle-http";

// "I'm here" ping from the website (tab visible) and the app (foreground), about every 30 seconds.
// Powers the live-users panel in the admin dashboard. Never shown to other users.
export async function POST(request) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ ok: false }, { status: 401 });
  const limited = await throttle(request, [["email", accountId, "presence", { max: 12, windowMs: 60 * 1000, label: "presence pings" }]]);
  if (limited) return NextResponse.json({ ok: true });   // too chatty: quietly ignore
  const b = await request.json().catch(() => ({}));
  // The app authenticates with a Bearer token and the site with a cookie, so that is a reliable fallback.
  const platform = b.platform === "app" || b.platform === "web" ? b.platform : request.headers.get("authorization") ? "app" : "web";
  if (b.state === "offline") await goOffline(accountId, platform);
  else await heartbeat(accountId, { platform, geo: resolveGeo(request.headers) });
  return NextResponse.json({ ok: true });
}
