import { NextResponse } from "next/server";
import { requireAccount, limit, companyFail } from "@/lib/company-http";
import * as reg from "@/lib/content/company-registry";
import { sendCompanyDomainCodeEmail } from "@/lib/email";

// POST { email }          -> sends a 6-digit code to that address
// POST { code }           -> confirms it
export async function POST(request, { params }) {
  const ctx = await requireAccount({ needVerified: true });
  if (ctx.error) return ctx.error;
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    if (body.code) return NextResponse.json(await reg.confirmDomainVerification({ id, ownerKey: ctx.ownerKey, code: body.code }));
    const blocked = await limit(ctx.accountId, "domain_code");
    if (blocked) return blocked;
    const { email, code, expiresInMin } = await reg.startDomainVerification({ id, ownerKey: ctx.ownerKey, email: body.email });
    const sent = await sendCompanyDomainCodeEmail(email, code, expiresInMin);
    if (!sent.sent) return NextResponse.json({ error: "We couldn't send the email. Try again shortly." }, { status: 502 });
    return NextResponse.json({ ok: true, email, expiresInMin });
  } catch (e) { return companyFail(e); }
}
