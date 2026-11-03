import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { getSoundPrefs, setSoundPrefs } from "@/lib/identity/service";

export async function GET() {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });
  return NextResponse.json(await getSoundPrefs(accountId));
}

// Any subset of the preference fields; unknown fields are dropped and every
// value is clamped/validated (see normalizeSoundPrefs).
export async function PUT(request) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  return NextResponse.json(await setSoundPrefs(accountId, body));
}
