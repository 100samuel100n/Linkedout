import { NextResponse } from "next/server";
import { contentDb } from "@/lib/content/db";
import { getFeedSettings } from "@/lib/admin/service";

// Public: what the feed needs from the admin "Feed Controls" — ad frequency / kill
// switch and currently-live announcements. Cached briefly at the edge.
export async function GET() {
  const s = await getFeedSettings();
  const now = new Date().toISOString();
  const ann = await contentDb.prepare("SELECT id, title, body, severity, audience FROM announcements WHERE active = 1 AND (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at >= ?) ORDER BY created_at DESC LIMIT 3").all(now, now);
  const every = (v, d) => Math.min(50, Math.max(2, Number(v) || d));
  const mix = s.network_mix || "direct first";
  return NextResponse.json({
    adsEnabled: s.ads_enabled !== "0", adEvery: every(s.ad_every, 5), adAudience: s.ad_audience === "all" ? "all" : "free",
    adLabel: s.ad_label || "Sponsored", adStyle: s.ad_style_default || "card", mix,
    adsense: { enabled: s.adsense_enabled === "1" && mix !== "direct only" && !!s.adsense_client && !!s.adsense_slot, client: s.adsense_client || null, slot: s.adsense_slot || null, every: every(s.adsense_every, 7) },
    admob: { enabled: s.admob_enabled === "1" && mix !== "direct only", androidUnit: s.admob_android_unit || null, iosUnit: s.admob_ios_unit || null, every: every(s.admob_every, 7) },
    announcements: ann }, { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=60" } });
}
