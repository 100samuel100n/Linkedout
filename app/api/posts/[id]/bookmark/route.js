import { NextResponse } from "next/server";
import { toggleBookmark } from "@/lib/content/service";
import { getCurrentAccountId } from "@/lib/session";
import { getOrCreateAlias } from "@/lib/identity/service";

export async function POST(request, { params }) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in to bookmark." }, { status: 401 });
  const { id } = await params;
  const anonKey = (await getOrCreateAlias(accountId)).anonymousId;
  const result = await toggleBookmark(id, anonKey);
  if (!result) return NextResponse.json({ error: "Post not found." }, { status: 404 });
  return NextResponse.json(result);
}
