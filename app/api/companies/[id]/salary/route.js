import { NextResponse } from "next/server";
import { addCompanySalary } from "@/lib/content/service";
import { getCurrentAccountId } from "@/lib/session";
import { issueContentToken, verifyContentToken } from "@/lib/identity/service";
import { checkRateLimit, RateLimitError } from "@/lib/identity/rate-limit";

const VALID_MODES = new Set(["real", "alias", "anon"]);

export async function POST(request, { params }) {
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

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const amount = Number(body?.amount);
  if (!amount || amount <= 0) return NextResponse.json({ error: "A positive salary amount is required." }, { status: 400 });
  const mode = VALID_MODES.has(body?.mode) ? body.mode : "anon"; // salary defaults to fully anonymous — sensitive by nature

  const { token } = await issueContentToken(accountId, mode);
  const identity = await verifyContentToken(token);

  const company = await addCompanySalary({
    companyId: id, anonymousId: identity.anonymousId, roleTitle: body?.roleTitle?.trim() || null, amount,
  });
  if (!company) return NextResponse.json({ error: "Company not found." }, { status: 404 });
  return NextResponse.json(company, { status: 201 });
}
