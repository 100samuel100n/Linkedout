import { pausable } from "@/lib/flags";
import { viewer, json, fail } from "@/lib/stories/http";
import { homepage } from "@/lib/jobs/service";
async function _GET() { const v = await viewer(); try { return json(await homepage(v.key ? v : null)); } catch (e) { return fail(e); } }

export const GET = pausable(_GET);
