import { NextResponse } from "next/server";
import { clearSessionCookie, getCurrentAccountId } from "@/lib/session";
import { goOffline } from "@/lib/admin/presence";

export async function POST() {
  // Drop this person from "Live now" immediately instead of letting them linger until the window expires.
  try {
    const id = await getCurrentAccountId();
    if (id) await Promise.all([goOffline(id, "web"), goOffline(id, "app")]);
  } catch { /* logging out must never fail because of presence */ }
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
