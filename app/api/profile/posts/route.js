import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { getAccountById, getAnonymousIdsForAccount } from "@/lib/identity/service";
import { getPostsByOwnership } from "@/lib/content/service";

export async function GET() {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });

  const account = await getAccountById(accountId);
  const anonymousIds = await getAnonymousIdsForAccount(accountId);
  const posts = await getPostsByOwnership(anonymousIds, account?.realName || null);
  return NextResponse.json(posts);
}
