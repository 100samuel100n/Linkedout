import { NextResponse } from "next/server";
import { noteCloneBeacon } from "@/lib/distribution/detect";
import { officialDomains } from "@/lib/distribution/db";
import { ctx } from "@/lib/distribution/http";
import { throttle } from "@/lib/identity/throttle-http";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type" };
export const OPTIONS = () => new NextResponse(null, { status: 204, headers: CORS });
// Sent by our own web code when it notices it is served from a hostname that is not ours (a cloned site).
export async function POST(request) {
  try {
    const limited = await throttle(request, [["ip", null, "dist_clone", { max: 20, windowMs: 3600000, label: "requests" }]]); if (limited) return limited;
    const b = await request.json().catch(() => ({})); const host = String(b.host || "").toLowerCase();
    if (host && !(await officialDomains()).includes(host) && !/^(localhost|127\.|192\.168\.)/.test(host)) await noteCloneBeacon({ host, ip: ctx(request).ip, referrer: b.referrer, path: b.path });
  } catch { /* never reveal anything to a clone */ }
  return NextResponse.json({ ok: true }, { headers: CORS });
}
