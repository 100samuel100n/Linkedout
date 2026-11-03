import { NextResponse } from "next/server";
import { createChallenge } from "@/lib/distribution/installs";
import { fail, ctx, NOSTORE } from "@/lib/distribution/http";
import { throttle } from "@/lib/identity/throttle-http";
export async function POST(request) {
  try {
    const limited = await throttle(request, [["ip", null, "dist_challenge", { max: 30, windowMs: 3600000, label: "setup attempts" }]]); if (limited) return limited;
    return NextResponse.json(await createChallenge(ctx(request).ip), { headers: NOSTORE });
  } catch (e) { return fail(e); }
}
