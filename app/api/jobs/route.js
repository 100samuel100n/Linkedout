<<<<<<< HEAD
import { pausable } from "@/lib/flags";
import { viewer, requireViewer, json, fail } from "@/lib/stories/http";
import { searchJobs, createJob } from "@/lib/jobs/service";
import { limited } from "@/lib/stories/http";

const arr = (sp, k) => sp.getAll(k).flatMap((x) => x.split(",")).filter(Boolean);
async function _GET(request) {
  const sp = new URL(request.url).searchParams, v = await viewer();
  try {
    return json(await searchJobs({ q: sp.get("q"), location: sp.get("location"), modes: arr(sp, "mode"), types: arr(sp, "type"), seniority: arr(sp, "seniority"), salaryMin: sp.get("salaryMin"), skills: arr(sp, "skill"),
      company: sp.get("company"), companyId: sp.get("companyId"), industry: sp.get("industry"), verifiedOnly: sp.get("verified") === "1", transparency: sp.get("transparency"), postedWithin: sp.get("postedWithin"),
      closesWithin: sp.get("closesWithin"), visa: sp.get("visa") === "1", relocation: sp.get("relocation") === "1", sort: sp.get("sort"), page: sp.get("page") }, v));
  } catch (e) { return fail(e); }
}
// Create a job. forWhom: my_company | other_company | community
async function _POST(request) {
  const v = await requireViewer({ restriction: "post" }); if (v.error) return v.error;
  const blocked = await limited(v.accountId, "post"); if (blocked) return blocked;
  const b = await request.json().catch(() => ({}));
  try { return json(await createJob(v, b), 201); } catch (e) { return fail(e); }
}

export const GET = pausable(_GET);
export const POST = pausable(_POST);
=======
import { NextResponse } from "next/server";
import { getJobs, createJob } from "@/lib/content/service";
import { getCurrentAccountId } from "@/lib/session";
import { issueContentToken, verifyContentToken } from "@/lib/identity/service";
import { checkRateLimit, RateLimitError } from "@/lib/identity/rate-limit";

const VALID_MODES = new Set(["real", "alias", "anon"]);

export async function GET() {
  return NextResponse.json(await getJobs());
}

export async function POST(request) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });

  try {
    await checkRateLimit(accountId, "post");
  } catch (e) {
    if (e instanceof RateLimitError) {
      return NextResponse.json({ error: e.message }, { status: 429, headers: { "Retry-After": String(Math.ceil(e.retryAfterMs / 1000)) } });
    }
    throw e;
  }

  const body = await request.json().catch(() => null);
  const title = body?.title?.trim();
  const companyName = body?.companyName?.trim();
  if (!title || !companyName) return NextResponse.json({ error: "Job title and company name are required." }, { status: 400 });
  const mode = VALID_MODES.has(body?.mode) ? body.mode : "alias";

  const { token } = await issueContentToken(accountId, mode);
  const identity = await verifyContentToken(token);

  const job = await createJob({
    title, companyName,
    salaryMin: body?.salaryMin ? Number(body.salaryMin) : null,
    salaryMax: body?.salaryMax ? Number(body.salaryMax) : null,
    lastPersonQuitReason: body?.lastPersonQuitReason?.trim() || null,
    anonymousId: identity.anonymousId, authorDisplay: identity.displayLabel,
  });
  return NextResponse.json(job, { status: 201 });
}
>>>>>>> origin/main
