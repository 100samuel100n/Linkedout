import { NextResponse } from "next/server";
import { ssoConfigured, beginSso } from "@/lib/security/sso";
export async function GET(request) {
  if (!ssoConfigured()) return NextResponse.json({ error: "SSO isn't configured." }, { status: 404 });
  try {
    const origin = new URL(request.url).origin;
    const { url, cookie } = await beginSso(process.env.APP_ORIGIN || origin, new URL(request.url).searchParams.get("next") || "/admin");
    const res = NextResponse.redirect(url);
    res.cookies.set("lo_sso", cookie, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/auth/sso", maxAge: 600 });
    return res;
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 502 }); }
}
