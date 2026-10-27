import { myStories } from "@/lib/stories/service";
import { requireViewer, json, fail } from "@/lib/stories/http";
import { getAnonymousIdsForAccount } from "@/lib/identity/service";
export async function GET() {
  const v = await requireViewer(); if (v.error) return v.error;
  try { return json({ stories: await myStories(await getAnonymousIdsForAccount(v.accountId), v.key) }); } catch (e) { return fail(e); }
}
