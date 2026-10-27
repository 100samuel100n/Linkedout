import { NextResponse } from "next/server";
import { requireAccount, limit, companyFail } from "@/lib/company-http";
import * as reg from "@/lib/content/company-registry";

export async function POST(request, { params }) {
  const ctx = await requireAccount({ needVerified: true });
  if (ctx.error) return ctx.error;
  const blocked = await limit(ctx.accountId, "company_doc");
  if (blocked) return blocked;
  const { id } = await params;
  const form = await request.formData().catch(() => null);
  const file = form?.get("document");
  if (!file || typeof file === "string") return NextResponse.json({ error: "Attach a document." }, { status: 400 });
  try {
    return NextResponse.json(await reg.addDocument({ id, ownerKey: ctx.ownerKey, docType: String(form.get("docType") || ""), file }), { status: 201 });
  } catch (e) { return companyFail(e); }
}

export async function DELETE(request, { params }) {
  const ctx = await requireAccount();
  if (ctx.error) return ctx.error;
  const { id } = await params;
  const documentId = new URL(request.url).searchParams.get("documentId");
  if (!documentId) return NextResponse.json({ error: "documentId is required." }, { status: 400 });
  try { return NextResponse.json(await reg.removeDocument({ id, ownerKey: ctx.ownerKey, documentId })); } catch (e) { return companyFail(e); }
}
