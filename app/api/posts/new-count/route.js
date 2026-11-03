import { NextResponse } from "next/server";
import { countNewerPosts } from "@/lib/content/service";

// Cheap "is there anything newer than what I'm showing?" check that
// powers the feed's "N new posts" banner. Returns only a count — one
// indexed COUNT query — so the client can poll it every ~45s without
// re-fetching (or re-rendering) the whole feed. Public, same as the feed.
export async function GET(request) {
  const since = new URL(request.url).searchParams.get("since");
  if (!since || Number.isNaN(Date.parse(since))) {
    return NextResponse.json({ error: "since (ISO timestamp) is required." }, { status: 400 });
  }
  return NextResponse.json({ count: Number(await countNewerPosts(since)) });
}
