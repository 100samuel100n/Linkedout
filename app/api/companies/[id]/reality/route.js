import { companyReality } from "@/lib/stories/service";
import { viewer, json, fail } from "@/lib/stories/http";

// The company page's centrepiece: stories, patterns, layoffs, why people left, interviews,
// salary reality, flags, truth gap, timeline, right of reply. Free for everyone to read.
export async function GET(_req, { params }) {
  const { id } = await params;
  const v = await viewer();
  try {
    const r = await companyReality(id, { viewerKey: v.key, tier: v.tier });
    if (!r) return json({ error: "Company not found." }, 404);
    return json(r);
  } catch (e) { return fail(e); }
}
