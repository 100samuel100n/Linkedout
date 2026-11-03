import { listStories, createStory, getStory } from "@/lib/stories/service";
import { identityRisk } from "@/lib/stories/redact";
import { viewer, requireViewer, limited, identityFor, json, fail } from "@/lib/stories/http";
import { assertCanPostInCircle } from "@/lib/stories/circles";
import { verifiedMap } from "@/lib/stories/verify";

// Public read. Query: category, format, company, companyId, circle, q, before, limit, sort=recent|resonating
export async function GET(request) {
  const v = await viewer();
  const u = new URL(request.url);
  const g = (k) => u.searchParams.get(k) || null;
  try {
    const stories = await listStories({
      viewerKey: v.key, category: g("category"), format: g("format"), company: g("company"), companyId: g("companyId"),
      circle: g("circle"), q: g("q"), before: g("before"), limit: Number(g("limit")) || 20, sort: g("sort") === "resonating" ? "resonating" : "recent",
    });
    return json({ stories, hasMore: stories.length >= (Number(g("limit")) || 20) });
  } catch (e) { return fail(e); }
}

export async function POST(request) {
  const v = await requireViewer({ restriction: "posting" });
  if (v.error) return v.error;
  const blocked = await limited(v.accountId, "story_create");
  if (blocked) return blocked;
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "Invalid request." }, 400);
  // Scheduling is an OUT+ perk; drafts are free (they never publish).
  if (body.publishAt && !v.perks.scheduledPublishing) return json({ error: "Scheduled publishing is part of OUT+.", code: "PLAN_REQUIRED", plan: "OUT+" }, 403);
  try {
    const identity = await identityFor(v.accountId, body.mode);
    if (body.circleSlug) await assertCanPostInCircle(body.circleSlug, v.key);
    const out = await createStory(body, identity, { verified: await verifiedMap(v.accountId) });
    const story = await getStory(out.id, v.key);
    // The author always learns what was removed, and (if their plan includes it) how identifiable the story is.
    const risk = v.perks.identityRisk ? identityRisk({ mode: body.mode, company: body.companyName, department: body.department, location: body.location, roleTitle: body.roleTitle, tenure: body.tenure, period: body.period, text: body.body }) : null;
    return json({ story, redactions: out.redactions, identityRisk: risk, noindex: out.noindex }, 201);
  } catch (e) { return fail(e); }
}
