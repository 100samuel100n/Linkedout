import { NextResponse } from "next/server";
import { contentDb } from "@/lib/content/db";
import { resolveGeo } from "@/lib/geo";
import { throttle } from "@/lib/identity/throttle-http";

// Impression / click beacons from the feed's sponsored cards. Feeds the admin
// Ad Performance numbers and per-campaign budget pacing. Public, light, throttled.
export async function POST(request) {
  const limited = await throttle(request, [["ip", null, "ad_event", { max: 600, windowMs: 60 * 1000, label: "ad events" }]]);
  if (limited) return NextResponse.json({ ok: false }, { status: 429 });
  const b = await request.json().catch(() => ({}));
  const adId = Number(b.adId);
  if (!Number.isInteger(adId) || !["impression", "click"].includes(b.kind)) return NextResponse.json({ ok: false }, { status: 400 });
  const geo = resolveGeo(request.headers);
  await contentDb.prepare("INSERT INTO ad_events (id, ad_id, kind, created_at, country, city) SELECT ?, id, ?, ?, ?, ? FROM ads WHERE id = ?").run(crypto.randomUUID(), b.kind, new Date().toISOString(), geo.country, geo.city, adId);
  return NextResponse.json({ ok: true });
}
