import { NextResponse } from "next/server";
import { buildManifest } from "@/lib/distribution/manifest";
import { fail } from "@/lib/distribution/http";
// The signed distribution manifest. Anyone may fetch it; only the holder of the signing key can produce a valid one.
export async function GET() {
  try { return NextResponse.json(await buildManifest(), { headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } }); } catch (e) { return fail(e); }
}
