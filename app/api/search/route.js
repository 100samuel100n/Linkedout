import { NextResponse } from "next/server";
import { searchContent } from "@/lib/content/service";
import { searchAccountsByPseudonym } from "@/lib/identity/service";

export async function GET(request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json({ posts: [], companies: [], jobs: [], rooms: [], people: [] });

  const contentResults = await searchContent(q);
  const people = await searchAccountsByPseudonym(q);
  return NextResponse.json({ ...contentResults, people });
}
