import { NextResponse } from "next/server";
import { getCompanyById } from "@/lib/content/service";
import { updateRegisteredCompany, softDeleteCompany, validateCompanyInput, eraseNow } from "@/lib/content/company-registry";
import { requireAccount, limit, companyFail } from "@/lib/company-http";
import { getCurrentAccountId } from "@/lib/session";
import { getOrCreateAlias } from "@/lib/identity/service";
import { recordItemView } from "@/lib/views";

export async function GET(request, { params }) {
  const { id } = await params;
  const accountId = await getCurrentAccountId();
  const key = accountId ? (await getOrCreateAlias(accountId)).anonymousId : null;
  const company = await getCompanyById(id, key);
  if (!company) return NextResponse.json({ error: "Company not found." }, { status: 404 });
  recordItemView("company", id, { viewerId: accountId, bucket: request.headers.get("x-forwarded-for") || "" }).catch(() => {});
  return NextResponse.json(company);
}

// Owner edit. Name changes are limited to one per 30 days, identity-defining
// changes reset verification, and every change is written to the audit log.
export async function PATCH(request, { params }) {
  const ctx = await requireAccount();
  if (ctx.error) return ctx.error;
  const blocked = await limit(ctx.accountId, "company_edit");
  if (blocked) return blocked;
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const changes = validateCompanyInput(body, { partial: true });
    return NextResponse.json(await updateRegisteredCompany({ id, ownerKey: ctx.ownerKey, changes }));
  } catch (e) { return companyFail(e); }
}

// Soft delete (restorable for 30 days). ?permanent=1 erases a page that is
// already deleted, immediately.
export async function DELETE(request, { params }) {
  const ctx = await requireAccount();
  if (ctx.error) return ctx.error;
  const blocked = await limit(ctx.accountId, "company_manage");
  if (blocked) return blocked;
  const { id } = await params;
  try {
    if (new URL(request.url).searchParams.get("permanent") === "1") return NextResponse.json(await eraseNow({ id, ownerKey: ctx.ownerKey }));
    return NextResponse.json(await softDeleteCompany({ id, ownerKey: ctx.ownerKey }));
  } catch (e) { return companyFail(e); }
}
