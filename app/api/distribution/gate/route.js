import { NextResponse } from "next/server";
import { gateFor, verifyRequest } from "@/lib/distribution/installs";
import { fail, NOSTORE } from "@/lib/distribution/http";
// What the app asks at start-up and every few hours: is my install OK, must I update, which features are switched off?
// Answers revoked installs too: they must learn they are revoked so they can register again.
export async function GET(request) {
  try {
    const h = request.headers; const id = h.get("x-lo-install") || ""; const code = +h.get("x-lo-app-code") || 0;
    const out = await gateFor(/^[0-9a-f-]{36}$/.test(id) ? id : null, code);
    let proof = null; if (id) { const v = await verifyRequest(h, ""); proof = v.ok ? "ok" : v.code; }
    // Only a caller that proves it is a registered install gets the policy details (feature switches, tamper policy, enforcement mode).
    // Everyone else learns only whether it must update or re-register.
    if (proof !== "ok") return NextResponse.json({ status: out.status, serverTime: out.serverTime, proof }, { headers: NOSTORE });
    return NextResponse.json({ ...out, proof }, { headers: NOSTORE });
  } catch (e) { return fail(e); }
}