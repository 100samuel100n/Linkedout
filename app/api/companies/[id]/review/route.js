import { NextResponse } from "next/server";
import { addCompanyReview } from "@/lib/content/service";
import { getCurrentAccountId } from "@/lib/session";
import { issueContentToken, verifyContentToken } from "@/lib/identity/service";
import { checkRateLimit, RateLimitError } from "@/lib/identity/rate-limit";

const VALID_MODES = new Set(["real", "alias", "anon"]);
const VALID_FLAGS = new Set(["red", "green"]);

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
  const flagType = body?.flagType;
  const tagText = body?.tagText?.trim();
  if (!VALID_FLAGS.has(flagType) || !tagText) {
    return NextResponse.json({ error: "flagType ('red' or 'green') and tagText are required." }, { status: 400 });
  }
  const mode = VALID_MODES.has(body?.mode) ? body.mode : "alias";
  const rating = Number(body?.rating);
  const validRating = Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null;

  const { token } = await issueContentToken(accountId, mode);
  const identity = await verifyContentToken(token);

  const company = await addCompanyReview({
    companyId: id, anonymousId: identity.anonymousId, authorDisplay: identity.displayLabel,
    flagType, tagText, body: body?.body?.trim() || null, rating: validRating,
  });
  if (!company) return NextResponse.json({ error: "Company not found." }, { status: 404 });
  return NextResponse.json(company, { status: 201 });
}
