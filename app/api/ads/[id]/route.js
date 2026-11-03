import { NextResponse } from "next/server";
import { getAds } from "@/lib/content/service";
import { resolveGeo } from "@/lib/geo";

// Public: one live ad (used by full page ads). Only ads that are currently
// approved and in their schedule are served.
export async function GET(req, { params }) {
  const { id } = await params;
  const ad = (await getAds(resolveGeo(req.headers))).find((a) => String(a.id) === String(id));
  if (!ad || ad.format !== "page" || !ad.page) return NextResponse.json({ error: "This ad is no longer available." }, { status: 404 });
  return NextResponse.json(ad);
}
