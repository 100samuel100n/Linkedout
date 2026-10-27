import { NextResponse } from "next/server";
import { getPublicAliasProfile } from "@/lib/content/service";
import { getAliasHandle, getFollowerCount, isFollowing, resolveAliasAccountId, recordProfileView } from "@/lib/identity/service";
import { getCurrentAccountId } from "@/lib/session";
import { getOrCreateAlias } from "@/lib/identity/service";
import { recordItemView } from "@/lib/views";

// /api/u/[handle] — handle is an alias-mode anonymous_id. Anything that
// isn't a real, currently-valid alias identity (including any anon-mode
// id, even a real one that exists) 404s here rather than resolving —
// that refusal is what keeps fully-anonymous posts unlinkable, which is
// the whole point of that mode existing.
export async function GET(request, { params }) {
  const { handle } = await params;
  const alias = await getAliasHandle(handle);
  if (!alias) return NextResponse.json({ error: "No profile here." }, { status: 404 });

  const accountId = await getCurrentAccountId();
  const viewerAnonKey = accountId ? (await getOrCreateAlias(accountId)).anonymousId : null;

  if (accountId) {
    const targetId = await resolveAliasAccountId(handle);
    recordProfileView(targetId, accountId).catch(() => {});
  }

  recordItemView("profile", handle, { viewerId: accountId, bucket: request.headers.get("x-forwarded-for") || "", isOwner: !!viewerAnonKey && viewerAnonKey === handle }).catch(() => {});
  const profile = await getPublicAliasProfile(handle, viewerAnonKey);
  return NextResponse.json({
    displayLabel: alias.displayLabel, avatarUrl: alias.avatarUrl, tier: alias.tier, handle, ...profile,
    followerCount: await getFollowerCount(handle),
    isFollowing: await isFollowing(accountId, handle),
    isSelf: Boolean(accountId) && (await getOrCreateAlias(accountId)).anonymousId === handle,
  });
}
