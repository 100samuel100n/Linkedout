import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { restrictionError } from "@/lib/admin/enforce";
import { requireMember, limited } from "@/lib/messaging/http";
import { messagingFor } from "@/lib/tiers";
import { transcodeAudio } from "@/lib/transcode";
import { uploadPublicObject } from "@/lib/storage";

// Upload a voice note or a file for a chat. OUT+ and OUT PRO only; the limits (voice length, file size) come from
// the live plan config, so an admin edit applies immediately. The file is stored under an unguessable key and the
// URL is only ever placed inside the encrypted message body, never in a public listing.
export const maxDuration = 60;

const VOICE = { "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/webm": "webm", "audio/ogg": "ogg", "video/webm": "webm", "audio/3gpp": "3gp" };
const FILE = {
  "application/pdf": "pdf", "application/msword": "doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt", "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt", "text/csv": "csv", "application/zip": "zip", "application/json": "json",
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4", "video/quicktime": "mov", "audio/mpeg": "mp3", "audio/mp4": "m4a",
};

export async function POST(request) {
  const m = await requireMember();
  if (m.error) return m.error;
  { const blocked = await restrictionError(m.accountId, "messaging"); if (blocked) return blocked; }
  const slow = await limited(m.accountId, "dm_send"); if (slow) return slow;
  const perks = messagingFor(m.tier);
  let form; try { form = await request.formData(); } catch { return NextResponse.json({ error: "Upload failed. Try again." }, { status: 400 }); }
  const kind = form.get("kind") === "voice" ? "voice" : "file";
  const file = form.get("file");
  if (!file || typeof file === "string") return NextResponse.json({ error: "Choose a file first." }, { status: 400 });

  if (kind === "voice" && !perks.voiceNotes) return NextResponse.json({ error: "Voice notes are available on OUT+ and OUT PRO.", code: "PLAN_REQUIRED", feature: "voiceNotes", requiredTier: "plus" }, { status: 403 });
  if (kind === "file" && !perks.fileSharing) return NextResponse.json({ error: "File sharing is available on OUT+ and OUT PRO.", code: "PLAN_REQUIRED", feature: "fileSharing", requiredTier: "plus" }, { status: 403 });

  const type = String(file.type || "").split(";")[0].toLowerCase();
  const ext = (kind === "voice" ? VOICE : FILE)[type];
  if (!ext) return NextResponse.json({ error: kind === "voice" ? "That audio format isn't supported." : "That file type isn't allowed. Use documents, spreadsheets, PDFs, images, audio, video or zip." }, { status: 415 });
  const maxMB = kind === "voice" ? 15 : perks.fileMaxMB || 25;
  if (file.size > maxMB * 1048576) return NextResponse.json({ error: `That's over the ${maxMB} MB limit for your plan.`, code: "TOO_LARGE" }, { status: 413 });
  const dur = Math.round(Number(form.get("dur")) || 0);
  if (kind === "voice" && perks.voiceNoteMaxSeconds && dur > perks.voiceNoteMaxSeconds + 2) return NextResponse.json({ error: "That voice note is longer than your plan allows.", code: "TOO_LONG" }, { status: 400 });

  try {
    let buf = Buffer.from(await file.arrayBuffer()); let outExt = ext; let outType = type;
    if (kind === "voice") { const t = await transcodeAudio(buf, ext).catch(() => null); if (t) { buf = t.buffer; outExt = t.ext; outType = t.ext === "m4a" ? "audio/mp4" : type; } }
    const url = await uploadPublicObject(`dm/${crypto.randomUUID()}.${outExt}`, buf, outType);
    const name = String(form.get("name") || file.name || `file.${outExt}`).slice(0, 120);
    return NextResponse.json({ type: kind, url, name, size: buf.length, mime: outType, dur: kind === "voice" ? dur : undefined });
  } catch (e) {
    console.error("[messages/upload]", e);
    return NextResponse.json({ error: "Couldn't upload that. Check your connection and try again." }, { status: 502 });
  }
}
