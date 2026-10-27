import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { getDmPrefs, setDmPrefs } from "@/lib/identity/service";

export async function GET() {
  const id = await getCurrentAccountId();
  if (!id) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });
  return NextResponse.json(await getDmPrefs(id));
}
export async function PUT(request) {
  const id = await getCurrentAccountId();
  if (!id) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });
  const b = await request.json().catch(() => null);
  if (!b || typeof b !== "object") return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  return NextResponse.json(await setDmPrefs(id, b));
}
