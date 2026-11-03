import { NextResponse } from "next/server";
import { requireViewer } from "@/lib/stories/http";
import { companyCtx } from "@/lib/stories/business";
import { beginCompanySso } from "@/lib/security/company-sso";
// A company representative starts their company's single sign-on.
export async function GET(request, { params }) {
  const { id } = await params; const v = await requireViewer(); if (v.error) return v.error;
  try { await companyCtx(id, v.key); const { url, cookie } = await beginCompanySso(new URL(request.url).origin, id, new URL(request.url).searchParams.get("next"));
    const res = NextResponse.redirect(url); res.cookies.set("lo_csso", cookie, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/auth/company-sso", maxAge: 600 }); return res; }
  catch (e) { return NextResponse.redirect(new URL(`/companies/${id}/dashboard?ssoerror=${encodeURIComponent(e.message)}`, request.url)); }
}
