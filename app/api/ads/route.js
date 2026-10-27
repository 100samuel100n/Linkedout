import { NextResponse } from "next/server";
import { getAds } from "@/lib/content/service";
import { resolveGeo } from "@/lib/geo";

// Which ads a viewer gets depends on where they are, so this can't be cached across places.
export async function GET(request) {
  return NextResponse.json(await getAds(resolveGeo(request.headers)), { headers: { "Cache-Control": "private, no-store", Vary: "x-client-country" } });
}
