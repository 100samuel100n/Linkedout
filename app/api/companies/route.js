import { NextResponse } from "next/server";
import { restrictionError } from "@/lib/admin/enforce";
import { getCompanies, getMyCompanies } from "@/lib/content/service";
import { createRegisteredCompany, validateCompanyInput, validateDeclarations } from "@/lib/content/company-registry";
import { requireAccount, limit, companyFail, displayFor } from "@/lib/company-http";
import { getCurrentAccountId } from "@/lib/session";
import { getOrCreateAlias, checkAndAwardBadges } from "@/lib/identity/service";

export async function GET(request) {
  const accountId = await getCurrentAccountId();
  const key = accountId ? (await getOrCreateAlias(accountId)).anonymousId : null;
  if (new URL(request.url).searchParams.get("mine") === "1") {
    if (!key) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });
    return NextResponse.json(await getMyCompanies(key));
  }
  return NextResponse.json(await getCompanies(key));
}

// Creating a page is deliberately hard to do casually: a verified email AND
// phone, a plan-based page allowance, a daily creation limit, full legal
// details, every declaration ticked, the company name typed to confirm, and
// the accepted terms version recorded. Duplicates are refused.
export async function POST(request) {
  const ctx = await requireAccount({ needVerified: true });
  if (ctx.error) return ctx.error;
  { const blocked = ctx.accountId && await restrictionError(ctx.accountId, "company_pages"); if (blocked) return blocked; }
  const blocked = await limit(ctx.accountId, "company_create");
  if (blocked) return blocked;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  try {
    const input = validateCompanyInput(body);
    validateDeclarations(body.declarations, body.confirmName, input.name);
    const who = await displayFor(ctx.accountId, body.mode);
    const company = await createRegisteredCompany({ input, ownerKey: ctx.ownerKey, authorDisplay: who.displayLabel, tier: ctx.tier });
    await checkAndAwardBadges(ctx.accountId, { startedCompany: true });
    return NextResponse.json(company, { status: 201 });
  } catch (e) { return companyFail(e); }
}
