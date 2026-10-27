import { NextResponse } from "next/server";
import { blocklistPayload } from "@/lib/security/core";
import { internalKey } from "@/lib/security/internal-key";
// Read by proxy.js (never by browsers): current IP/country rules and honeytoken strings.
export async function GET(request) {
  if (request.headers.get("x-sec-key") !== internalKey()) return new NextResponse("Not found", { status: 404 });
  return NextResponse.json(await blocklistPayload(), { headers: { "Cache-Control": "no-store" } });
}
