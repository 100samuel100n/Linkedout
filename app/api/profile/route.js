import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { getAccountById, updateProfile, serializeAccountForClient } from "@/lib/identity/service";

export async function GET() {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });
  const account = await getAccountById(accountId);
  if (!account) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  return NextResponse.json({ user: await serializeAccountForClient(account) });
}

const PSEUDONYM_RE = /^[a-zA-Z0-9_]{3,24}$/;

export async function PATCH(request) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const updates = {};
  if (body.pseudonym !== undefined) {
    if (!PSEUDONYM_RE.test(body.pseudonym)) {
      return NextResponse.json({ error: "Pseudonym must be 3-24 characters: letters, numbers, and underscores only." }, { status: 400 });
    }
    updates.pseudonym = body.pseudonym;
  }
  if (body.bio !== undefined) updates.bio = String(body.bio);
  if (body.realName !== undefined) updates.realName = String(body.realName);
  if (body.country !== undefined) updates.country = body.country ? String(body.country) : null;
  if (body.accountType !== undefined) updates.accountType = body.accountType;
  if (body.interests !== undefined) updates.interests = Array.isArray(body.interests) ? body.interests : [];

  try {
    const account = await updateProfile(accountId, updates);
    return NextResponse.json({ user: await serializeAccountForClient(account) });
  } catch (e) {
    if (e.code === "PSEUDONYM_TAKEN") {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    if (e.code === "PSEUDONYM_COOLDOWN" || e.code === "REAL_NAME_COOLDOWN") {
      return NextResponse.json({ error: e.message, code: e.code, nextAllowedAt: e.nextAllowedAt }, { status: 429 });
    }
    console.error("Profile update failed:", e);
    return NextResponse.json({ error: "Could not update profile." }, { status: 500 });
  }
}
