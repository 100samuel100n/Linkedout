import { NextResponse } from "next/server";
import { identityDb } from "@/lib/identity/db";
import { verifyRequest } from "@/lib/distribution/installs";
import { cleanPrecise } from "@/lib/distribution/details";
import { fail, NOSTORE } from "@/lib/distribution/http";
import { throttle } from "@/lib/identity/throttle-http";
// Precise location, sent only after the person agreed in the app's own prompt (consent:true is required and stored with it).
export async function POST(request) {
  try {
    const limited = await throttle(request, [["ip", null, "dist_loc", { max: 30, windowMs: 3600000, label: "location updates" }]]); if (limited) return limited;
    const v = await verifyRequest(request.headers, ""); if (!v.ok) return NextResponse.json({ error: v.message, code: v.code }, { status: 403, headers: NOSTORE });
    const body = await request.json().catch(() => null); const pr = cleanPrecise({ ...body, accuracy: body?.accuracy });
    if (!pr) return NextResponse.json({ error: "Location not accepted." }, { status: 400, headers: NOSTORE });
    await identityDb.prepare("UPDATE dist_installs SET precise = ? WHERE install_id = ?").run(pr, v.installId);
    return NextResponse.json({ ok: true }, { headers: NOSTORE });
  } catch (e) { return fail(e); }
}
