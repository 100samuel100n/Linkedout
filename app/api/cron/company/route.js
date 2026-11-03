import { NextResponse } from "next/server";
import { runDueReports } from "@/lib/stories/company-extras";
import { runJobMaintenance } from "@/lib/jobs/maintenance";

// Scheduled company reports and job housekeeping. Same auth as /api/cron/broadcasts (Authorization: Bearer CRON_SECRET).
export async function GET(request) { return run(request); }
export async function POST(request) { return run(request); }
async function run(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET isn't set on the server." }, { status: 503 });
  if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  return NextResponse.json({ ok: true, reports: await runDueReports(), jobs: await runJobMaintenance() });
}
