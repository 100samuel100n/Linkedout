import { NextResponse } from "next/server";
// Liveness check for the host's health checks and canary deploys. Deliberately touches nothing else.
export async function GET() { return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } }); }
