import { layoffTracker } from "@/lib/stories/service";
import { json, fail } from "@/lib/stories/http";
export async function GET(request) {
  const u = new URL(request.url);
  try { return json(await layoffTracker({ days: Math.min(730, Number(u.searchParams.get("days")) || 365), q: u.searchParams.get("q") || null })); } catch (e) { return fail(e); }
}
