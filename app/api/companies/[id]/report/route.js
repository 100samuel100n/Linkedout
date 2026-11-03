import { NextResponse } from "next/server";
import { requireAccount, limit, companyFail } from "@/lib/company-http";
import * as reg from "@/lib/content/company-registry";
import { createNotification, resolveAliasAccountId } from "@/lib/identity/service";

// Anyone logged in can report a fake page or false, damaging content.
export async function POST(request, { params }) {
  const ctx = await requireAccount();
  if (ctx.error) return ctx.error;
  const blocked = await limit(ctx.accountId, "company_report");
  if (blocked) return blocked;
  const { id } = await params;
  const b = await request.json().catch(() => ({}));
  try {
    const r = await reg.fileDispute({ companyId: id, reporterKey: ctx.ownerKey, targetType: b.targetType || "company", targetId: b.targetId, reason: b.reason, details: b.details });
    // Tell the page owner a report exists (not who filed it).
    const ownerAccount = r.ownerKey && r.ownerKey !== ctx.ownerKey ? await resolveAliasAccountId(r.ownerKey) : null;
    if (ownerAccount) await createNotification(ownerAccount, "company_update", "A report was filed on one of your company pages. It will be reviewed.", null);
    return NextResponse.json({ ok: true, id: r.id }, { status: 201 });
  } catch (e) { return companyFail(e); }
}
