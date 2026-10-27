import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { getNotificationPreferences, setNotificationPreference } from "@/lib/identity/service";
import { NOTIFICATION_CATEGORIES } from "@/lib/identity/notification-categories";

export async function GET() {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });

  const prefs = await getNotificationPreferences(accountId);
  const categories = Object.fromEntries(
    Object.entries(NOTIFICATION_CATEGORIES).map(([key, def]) => [
      key,
      { label: def.label, description: def.description, ...prefs[key] },
    ])
  );
  return NextResponse.json({ categories });
}

// body: { category, inApp?, email?, push? } — any field omitted keeps its
// current value (see setNotificationPreference's merge logic).
export async function PUT(request) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body?.category) return NextResponse.json({ error: "category is required." }, { status: 400 });

  try {
    const next = await setNotificationPreference(accountId, body.category, {
      inApp: body.inApp, email: body.email, push: body.push,
    });
    return NextResponse.json({ ok: true, category: body.category, ...next });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
