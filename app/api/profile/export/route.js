import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { exportIdentityData, getAnonymousIdsForAccount } from "@/lib/identity/service";
import { getPostsByOwnership } from "@/lib/content/service";

// Self-service data export — everything this account is entitled to see
// about itself, assembled from both services (this is the one place that
// legitimately needs to cross the identity/content boundary: it's the
// account asking for its own data, not a third party unmasking someone
// else, so it doesn't need break-glass — same reasoning as "my posts").
export async function GET() {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });

  const identityData = await exportIdentityData(accountId);
  const anonymousIds = await getAnonymousIdsForAccount(accountId);
  const posts = (await getPostsByOwnership(anonymousIds, identityData.profile.realName)).map((p) => ({
    id: p.id, type: p.type, text: p.text, title: p.title, createdAt: p.createdAt,
    repostOf: p.repostOf, cringeVotes: p.cringeVotes, commentCount: p.commentCount,
  }));

  const exportData = {
    exportedAt: new Date().toISOString(),
    ...identityData,
    posts,
  };

  return new NextResponse(JSON.stringify(exportData, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="linkedout-data-export.json"`,
    },
  });
}
