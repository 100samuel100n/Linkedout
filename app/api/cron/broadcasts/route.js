import { NextResponse } from "next/server";
import { processDueBroadcasts } from "@/lib/admin/broadcast";

// Runs any scheduled push/email broadcasts that are due. Not needed on a long-running
// server (instrumentation.js already does this every minute), but handy for serverless
// hosts or an external scheduler: call it every minute with
//   Authorization: Bearer <CRON_SECRET>
// (Vercel Cron adds that header automatically when CRON_SECRET is set.)
export async function GET(request) { return run(request); }
export async function POST(request) { return run(request); }
async function run(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET isn't set on the server." }, { status: 503 });
  const auth = request.headers.get("authorization") || "";
  if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  await processDueBroadcasts();
  return NextResponse.json({ ok: true });
}
