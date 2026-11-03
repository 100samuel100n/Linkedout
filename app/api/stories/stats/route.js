import { platformStats, workplaceTrends } from "@/lib/stories/service";
import { json, fail } from "@/lib/stories/http";
export async function GET() {
  try { const [stats, t] = await Promise.all([platformStats(), workplaceTrends()]); return json({ ...stats, trends: t.trends, trendsMethod: t.method }); } catch (e) { return fail(e); }
}
