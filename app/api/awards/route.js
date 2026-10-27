import { NextResponse } from "next/server";
import { getCringeLeaderboard } from "@/lib/content/service";

export async function GET() {
  return NextResponse.json(await getCringeLeaderboard());
}
