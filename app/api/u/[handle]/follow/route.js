import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { followHandle, unfollowHandle } from "@/lib/identity/service";

export async function POST(request, { params }) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });

  const { handle } = await params;
  try {
    const result = await followHandle(accountId, handle);
    return NextResponse.json(result);
  } catch (e) {
    const status = e.code === "NOT_FOUND" ? 404 : e.code === "SELF_FOLLOW" ? 400 : 500;
    return NextResponse.json({ error: e.message }, { status });
  }
}

export async function DELETE(request, { params }) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });

  const { handle } = await params;
  const result = await unfollowHandle(accountId, handle);
  return NextResponse.json(result);
}
