import { NextResponse } from "next/server";
import { verifyRequest } from "@/lib/distribution/installs";
import { leaseFor } from "@/lib/distribution/kill";
import { fail, NOSTORE } from "@/lib/distribution/http";
import { throttle } from "@/lib/identity/throttle-http";

// The app's licence lease: a short-lived Ed25519-signed permission slip (status "ok", with an expiry), or a signed KILL ORDER
// ({status:"killed", wipe:true}). The app verifies it with the public key compiled into it, stores it, and refuses to run on an expired
// one (when leases are required). A killed install is answered without a signature check, so it always learns the truth.
export async function GET(request) {
  try {
    const limited = await throttle(request, [["ip", null, "dist_lease", { max: 240, windowMs: 3600000, label: "licence checks" }]]); if (limited) return limited;
    const h = request.headers, id = h.get("x-lo-install") || "";
    if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "Bad request.", code: "INSTALL_REQUIRED" }, { status: 400, headers: NOSTORE });
    const v = await verifyRequest(h, "");
    const r = await leaseFor(id, { verified: v.ok });
    if (r.unknown) return NextResponse.json({ error: "Unknown install.", code: "INSTALL_UNKNOWN" }, { status: 404, headers: NOSTORE });
    if (r.needSignature) return NextResponse.json({ error: "Request could not be verified.", code: v.code }, { status: 403, headers: NOSTORE });
    return NextResponse.json(r.env, { headers: NOSTORE });
  } catch (e) { return fail(e); }
}
