import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { isAppleConfigured, buildAppleAuthUrl } from "@/lib/oauth";

export async function GET() {
  if (process.env.APPLE_SIGNIN_ENABLED !== "true") return Response.json({ error: "Sign in with Apple is coming soon.", code: "APPLE_COMING_SOON" }, { status: 503 });
  if (!isAppleConfigured()) {
    return NextResponse.json(
      { error: "Apple sign-in isn't configured yet — see linkedout-app/README.md § Apple Sign In for what's needed.", code: "APPLE_NOT_CONFIGURED" },
      { status: 503 }
    );
  }
  const state = crypto.randomBytes(16).toString("hex");
  const store = await cookies();
  store.set("lo_oauth_state", state, { httpOnly: true, maxAge: 600, path: "/", sameSite: "lax" });
  return NextResponse.redirect(buildAppleAuthUrl(state));
}
