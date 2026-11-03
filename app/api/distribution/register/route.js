import { NextResponse } from "next/server";
import { registerInstall } from "@/lib/distribution/installs";
import { fail, ctx, NOSTORE } from "@/lib/distribution/http";
import { throttle } from "@/lib/identity/throttle-http";
// The app sends its hardware attestation chain + proof of key possession. See lib/distribution/attest.js.
export async function POST(request) {
  try {
    const limited = await throttle(request, [["ip", null, "dist_register", { max: 12, windowMs: 3600000, label: "setup attempts" }]]); if (limited) return limited;
    const body = await request.json().catch(() => null); if (!body) return NextResponse.json({ error: "Bad request." }, { status: 400 });
    const { ip, country } = ctx(request);
    return NextResponse.json(await registerInstall({ body, ip, country, headers: request.headers }), { headers: NOSTORE });
  } catch (e) { return fail(e); }
}
