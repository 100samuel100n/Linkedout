import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { isGoogleConfigured, buildGoogleAuthUrl } from "@/lib/oauth";
import { signToken } from "@/lib/identity/crypto";
import { appReturnResponse } from "@/lib/identity/app-return";

// Starts Google sign-in. Used by the website (redirects back to the site) AND by
// the native app (?app=1&return=<linkedout:// or exp:// URL>): the app opens this
// URL in an in-app browser, the SAME web OAuth client does the work, and the
// callback hands a one-time ticket back to the app's return URL. That means the
// native app needs no Google client IDs of its own — only the server's.
const ALLOWED_RETURN = /^(linkedout|exp|exps):\/\//;

export async function GET(request) {
  const url = new URL(request.url);
  const isApp = url.searchParams.get("app") === "1";
  const ret = url.searchParams.get("return") || "";
  if (isApp && !ALLOWED_RETURN.test(ret)) return NextResponse.json({ error: "Invalid return URL." }, { status: 400 });
  const sep = (u) => (u.includes("?") ? "&" : "?");
  if (!isGoogleConfigured()) {
    if (isApp) return appReturnResponse(`${ret}${sep(ret)}error=not_configured`, { failed: true });
    return NextResponse.json({ error: "Google sign-in isn't configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.local.", code: "GOOGLE_NOT_CONFIGURED" }, { status: 503 });
  }
  const nonce = crypto.randomBytes(16).toString("hex");
  const state = isApp ? signToken({ n: nonce, r: ret, exp: Date.now() + 10 * 60 * 1000 }) : nonce;
  const store = await cookies();
  store.set("lo_oauth_state", state, { httpOnly: true, maxAge: 600, path: "/", sameSite: "lax" });
  return NextResponse.redirect(buildGoogleAuthUrl(state));
}
