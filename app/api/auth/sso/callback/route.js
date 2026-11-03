import { NextResponse } from "next/server";
import { ssoConfigured, finishSso } from "@/lib/security/sso";
import { identityDb } from "@/lib/identity/db";
import { createSessionCookie } from "@/lib/session";
import { isStaffRole } from "@/lib/admin/roles";
import { noteLogin, noteAuthFailure, requestInfo } from "@/lib/security/core";
// SSO is for staff only. Anyone else (or an unknown email) is sent back to the normal login with a generic message.
export async function GET(request) {
  if (!ssoConfigured()) return NextResponse.redirect(new URL("/login", request.url));
  const url = new URL(request.url), origin = process.env.APP_ORIGIN || url.origin;
  const fail = (msg) => NextResponse.redirect(new URL(`/login?sso_error=${encodeURIComponent(msg)}`, origin));
  try {
    const out = await finishSso(origin, { code: url.searchParams.get("code"), state: url.searchParams.get("state") }, request.cookies.get("lo_sso")?.value);
    const acct = await identityDb.prepare("SELECT id, role FROM accounts WHERE lower(email) = ?").get(out.email);
    if (!acct || !isStaffRole(acct.role)) { await noteAuthFailure({ email: out.email, ip: (await requestInfo()).ip }); return fail("This account isn't set up for staff sign-in."); }
    noteLogin(acct.id).catch(() => {});
    await createSessionCookie(acct.id);
    const res = NextResponse.redirect(new URL(out.next, origin));
    res.cookies.delete("lo_sso");
    return res;
  } catch (e) { return fail(e.message || "SSO failed."); }
}
