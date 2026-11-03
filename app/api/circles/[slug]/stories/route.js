import { circleStories } from "@/lib/stories/circles";
import { viewer, json, fail } from "@/lib/stories/http";
export async function GET(request, { params }) { const { slug } = await params; const v = await viewer(); const u = new URL(request.url); try { return json({ stories: await circleStories(slug, v.key, { before: u.searchParams.get("before"), sort: u.searchParams.get("sort") }) }); } catch (e) { return fail(e); } }
