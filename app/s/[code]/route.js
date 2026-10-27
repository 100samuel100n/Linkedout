import { NextResponse } from "next/server";
import { contentDb } from "@/lib/content/db";
import { getAppUrl } from "@/lib/config";

// Short share links: /s/ab12cd34 -> /stories/<full id>. The code is the first 8 characters of the story id, so
// there is nothing extra to store or keep in sync, and links keep working for as long as the story exists.
export async function GET(request, { params }) {
  const { code } = await params;
  const base = getAppUrl().replace(/\/$/, "");
  if (!/^[0-9a-f]{8}$/i.test(code)) return NextResponse.redirect(`${base}/stories`, 307);
  const row = await contentDb.prepare("SELECT id FROM stories WHERE id LIKE ? AND status = 'published' LIMIT 1").get(code.toLowerCase() + "%");
  return NextResponse.redirect(row ? `${base}/stories/${row.id}?ref=share` : `${base}/stories`, row ? 308 : 307);
}
