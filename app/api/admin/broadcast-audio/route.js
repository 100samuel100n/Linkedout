import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { requireStaff } from "@/lib/admin/guard";
import { SECTIONS } from "@/lib/admin/roles";
import { logStaff } from "@/lib/admin/enforce";
import { uploadPublicObject } from "@/lib/storage";

// Staff upload of a voice note / audio clip / song to attach to a push broadcast. The audio never rides inside the
// push itself (payloads are capped at ~4 KB): the app receives a small descriptor and downloads this file in the
// background. Large files are fine; the size cap is 60 MB.
export const maxDuration = 120;
const TYPES = { "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg", "audio/webm": "webm", "audio/flac": "flac", "audio/x-flac": "flac" };
const MAX = 60 * 1048576;

export async function POST(request) {
  const perm = SECTIONS.find((s) => s.id === "push")?.perm;
  const { staff, error } = await requireStaff(perm);
  if (error) return error;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return NextResponse.json({ error: "Choose an audio file." }, { status: 400 });
  const type = String(file.type || "").split(";")[0].toLowerCase();
  const ext = TYPES[type];
  if (!ext) return NextResponse.json({ error: "Use an MP3, M4A, AAC, WAV, OGG, WebM or FLAC file." }, { status: 415 });
  if (file.size > MAX) return NextResponse.json({ error: "That file is over 60 MB." }, { status: 413 });
  try {
    const url = await uploadPublicObject(`broadcast/${crypto.randomUUID()}.${ext}`, Buffer.from(await file.arrayBuffer()), type);
    await logStaff(staff, "broadcast:audio:upload", null, `${file.name || "audio"} · ${Math.round(file.size / 1024)} KB`);
    return NextResponse.json({ url, bytes: file.size, mime: type, name: file.name || `audio.${ext}` });
  } catch (e) {
    console.error("[broadcast-audio]", e);
    return NextResponse.json({ error: "Couldn't upload that file. Check the storage settings and try again." }, { status: 502 });
  }
}
