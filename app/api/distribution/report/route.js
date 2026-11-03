import { NextResponse } from "next/server";
import { distReady, uid, now, hashIp } from "@/lib/distribution/db";
import { identityDb } from "@/lib/identity/db";
import { noteUserReport } from "@/lib/distribution/detect";
import { fail, ctx } from "@/lib/distribution/http";
import { throttle } from "@/lib/identity/throttle-http";
// Anyone (signed in or not) can report a site, APK or app that looks like a fake LinkedOut.
export async function POST(request) {
  try {
    const limited = await throttle(request, [["ip", null, "dist_report", { max: 8, windowMs: 3600000, label: "reports" }]]); if (limited) return limited;
    const b = await request.json().catch(() => null); const target = String(b?.target || "").trim().slice(0, 250); const detail = String(b?.detail || "").trim().slice(0, 1500);
    if (!target && !detail) return NextResponse.json({ error: "Tell us the website or where you found the app." }, { status: 400 });
    const kind = ["website", "apk", "app", "other"].includes(b?.kind) ? b.kind : "other"; await distReady(); const id = uid(); const { ip } = ctx(request);
    await identityDb.prepare("INSERT INTO dist_reports (id, kind, target, detail, ip_hash, created_at) VALUES (?,?,?,?,?,?)").run(id, kind, target || null, detail || null, hashIp(ip), now());
    noteUserReport({ id, kind, target, detail }).catch(() => {});
    return NextResponse.json({ ok: true, message: "Thank you. Our security team will look at this." });
  } catch (e) { return fail(e); }
}
