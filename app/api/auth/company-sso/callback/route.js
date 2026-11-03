import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentAccountId } from "@/lib/session";
import { getAccountById } from "@/lib/identity/service";
import { finishCompanySso, makeSsoSession, ssoCookieName } from "@/lib/security/company-sso";
export async function GET(request) {
  const u = new URL(request.url), jar = await cookies(); const fail = (id, m) => NextResponse.redirect(new URL(`/companies/${id || ""}/dashboard?ssoerror=${encodeURIComponent(m)}`, request.url));
  let co = null;
  try {
    const accountId = await getCurrentAccountId(); if (!accountId) return NextResponse.redirect(new URL("/login", request.url));
    const r = await finishCompanySso(u.origin, { code: u.searchParams.get("code"), state: u.searchParams.get("state") }, jar.get("lo_csso")?.value); co = r.companyId;
    // The provider proves WHO is at the keyboard; it must be the same person as the LinkedOut account that is signed in.
    const acct = await getAccountById(accountId); if (!acct?.email || acct.email.toLowerCase() !== r.email) return fail(co, "Your company sign-in email must match your LinkedOut account email.");
    const res = NextResponse.redirect(new URL(r.next, request.url));
    res.cookies.set(ssoCookieName(co), makeSsoSession(co, accountId, r.minutes), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: r.minutes * 60 }); res.cookies.delete("lo_csso"); return res;
  } catch (e) { return fail(co, e.message || "Single sign-on failed."); }
}
