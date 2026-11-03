import { NextResponse } from "next/server";
import { wafHit, honeytokenHit } from "@/lib/security/core";
import { internalKey } from "@/lib/security/internal-key";
// proxy.js reports WAF matches and honeytoken sightings here so they become alerts.
export async function POST(request) {
  if (request.headers.get("x-sec-key") !== internalKey()) return new NextResponse("Not found", { status: 404 });
  const b = await request.json().catch(() => null);
  if (!b) return NextResponse.json({ ok: false }, { status: 400 });
  if (b.kind === "honeytoken") await honeytokenHit({ ip: b.ip, how: "decoy credential presented", detail: { path: String(b.path || "").slice(0, 200) } });
  else await wafHit({ ip: b.ip, rule: b.rule, label: b.label, path: b.path, ua: b.ua });
  return NextResponse.json({ ok: true });
}
