import { pausable } from "@/lib/flags";
import { json, fail } from "@/lib/stories/http";
import { jobIntel } from "@/lib/jobs/service";
// "Before you apply": aggregates about the company behind this job, with sample sizes. Public, like the company page.
async function _GET(request, { params }) { const { id } = await params; try { return json(await jobIntel(id)); } catch (e) { return fail(e); } }

export const GET = pausable(_GET);
