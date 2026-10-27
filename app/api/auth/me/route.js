import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { getAccountById, serializeAccountForClient } from "@/lib/identity/service";
import { mfaEnabled } from "@/lib/identity/mfa";

export async function GET() {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ user: null });
  const account = await getAccountById(accountId);
  if (!account) return NextResponse.json({ user: null });
  return NextResponse.json({ user: { ...(await serializeAccountForClient(account)), twoFactorEnabled: await mfaEnabled(accountId) } });
}
