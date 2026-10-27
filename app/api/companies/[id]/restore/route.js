import { NextResponse } from "next/server";
import { requireAccount, limit, companyFail } from "@/lib/company-http";
import * as reg from "@/lib/content/company-registry";

export async function POST(request, { params }) {
  const ctx = await requireAccount();
  if (ctx.error) return ctx.error;
  const blocked = await limit(ctx.accountId, "company_manage");
  if (blocked) return blocked;
  const { id } = await params;
  try { return NextResponse.json(await reg.restoreCompany({ id, ownerKey: ctx.ownerKey, tier: ctx.tier })); } catch (e) { return companyFail(e); }
}
