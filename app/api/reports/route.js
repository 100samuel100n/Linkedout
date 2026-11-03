import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { getOrCreateAlias } from "@/lib/identity/service";
import { contentDb } from "@/lib/content/db";

// Users report a post, comment, room or company. reporter_key is the
// account's persistent alias id (the same opaque dedup key reactions use),
// so moderators see the report but never who filed it. Feeds the admin
// Reports Center.
const TYPES = new Set(["post", "comment", "room", "company"]);
export async function POST(request) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in to report." }, { status: 401 });
  const b = await request.json().catch(() => ({}));
  if (!TYPES.has(b.targetType) || !b.targetId || !b.reason) return NextResponse.json({ error: "targetType, targetId and reason are required." }, { status: 400 });
  const { anonymousId: key } = await getOrCreateAlias(accountId);
  const dupe = await contentDb.prepare("SELECT id FROM content_reports WHERE target_type=? AND target_id=? AND reporter_key=? AND status='open'").get(b.targetType, String(b.targetId), key);
  if (dupe) return NextResponse.json({ ok: true, duplicate: true });
  await contentDb.prepare("INSERT INTO content_reports (id, target_type, target_id, reporter_key, reason, details, created_at) VALUES (?,?,?,?,?,?,?)")
    .run(crypto.randomUUID(), b.targetType, String(b.targetId), key, String(b.reason).slice(0, 60), String(b.details || "").slice(0, 1000), new Date().toISOString());
  return NextResponse.json({ ok: true });
}
