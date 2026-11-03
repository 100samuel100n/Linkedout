import { NextResponse } from "next/server";
import { getBookmarkedPosts } from "@/lib/content/service";
import { getCurrentAccountId } from "@/lib/session";
import { getOrCreateAlias } from "@/lib/identity/service";

export async function GET() {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });
  const anonKey = (await getOrCreateAlias(accountId)).anonymousId;
  return NextResponse.json(await getBookmarkedPosts(anonKey));
}
