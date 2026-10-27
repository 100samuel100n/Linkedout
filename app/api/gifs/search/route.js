import { NextResponse } from "next/server";
import { isGifSearchConfigured, searchGifs, trendingGifs } from "@/lib/gifs";
import { getCurrentAccountId } from "@/lib/session";
import { throttle } from "@/lib/identity/throttle-http";

export async function GET(request) {
  if (!isGifSearchConfigured()) return NextResponse.json({ configured: false, results: [] });

  // Keeps a scripted client from burning the provider quota.
  const limited = await throttle(request, [
    ["ip", null, "gif-search", { max: 120, windowMs: 10 * 60 * 1000, label: "GIF searches" }],
  ]);
  if (limited) return limited;

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim().slice(0, 80);
  const accountId = await getCurrentAccountId();
  try {
    const results = q ? await searchGifs(q, 24, accountId) : await trendingGifs(24, accountId);
    return NextResponse.json({ configured: true, results }, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (e) {
    console.error("[gifs]", e.message);
    return NextResponse.json({ configured: true, results: [], error: "GIF search is having trouble. Try again in a moment." }, { status: 502 });
  }
}
