import { NextResponse } from "next/server";
import { honeytokenHit, requestInfo } from "@/lib/security/core";
// Decoy endpoint. No real feature lives here, so any request is hostile or a scanner: it raises a critical alert
// and gets a boring, plausible-looking failure so the visitor learns nothing.
async function trap(request) {
  const { ip } = await requestInfo();
  await honeytokenHit({ ip, how: "honeypot endpoint requested", detail: { path: new URL(request.url).pathname, method: request.method } });
  await new Promise((r) => setTimeout(r, 1500));
  return NextResponse.json({ error: "Service temporarily unavailable." }, { status: 503 });
}
export const GET = trap, POST = trap, PUT = trap, DELETE = trap;
