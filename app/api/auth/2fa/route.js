import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { mfaStatus, startSetup, enable, disable } from "@/lib/identity/mfa";
import { throttle } from "@/lib/identity/throttle-http";

// Manage your own two-factor authentication (Settings → Security).
//   GET                         → { enabled, recoveryLeft }
//   POST { action: "setup" }    → { secret, uri }   (uri is rendered as a QR code client-side)
//   POST { action: "enable", code }            → { recoveryCodes }
//   POST { action: "disable", password, code } → { ok }
export async function GET() {
  const id = await getCurrentAccountId();
  if (!id) return NextResponse.json({ error: "Log in first." }, { status: 401 });
  return NextResponse.json(await mfaStatus(id));
}
export async function POST(request) {
  const id = await getCurrentAccountId();
  if (!id) return NextResponse.json({ error: "Log in first." }, { status: 401 });
  const b = await request.json().catch(() => ({}));
  try {
    if (b.action === "setup") return NextResponse.json(await startSetup(id));
    const limited = await throttle(request, [["email", id, "mfa_manage", { max: 10, windowMs: 15 * 60 * 1000, label: "attempts" }]]);
    if (limited) return limited;
    if (b.action === "enable") return NextResponse.json({ ok: true, ...(await enable(id, b.code)) });
    if (b.action === "disable") { await disable(id, b.password, b.code); return NextResponse.json({ ok: true }); }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    if (e.status) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("2FA error:", e); return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
