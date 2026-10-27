import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { getAccountById, setAvatarPath, clearAvatarPath } from "@/lib/identity/service";
import { saveAvatar, deleteAvatarFile, AVATAR_MAX_BYTES } from "@/lib/avatars";

export async function POST(request) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });

  const contentType = request.headers.get("content-type") || "";
  console.log("[avatar] request", { accountId, contentType: contentType.split(";")[0], length: request.headers.get("content-length"), ua: (request.headers.get("user-agent") || "").slice(0, 60) });

  let file = null;
  if (contentType.includes("application/json")) {
    // Mobile path: the app sends the (already cropped, compressed) photo as base64 JSON. Plain JSON
    // is the one request shape React Native never struggles with, unlike multipart on Android.
    const body = await request.json().catch((e) => { console.error("[avatar] bad json", { accountId, message: e?.message }); return null; });
    const b64 = typeof body?.image === "string" ? body.image.replace(/^data:[^;]+;base64,/, "") : "";
    if (b64) {
      const buf = Buffer.from(b64, "base64");
      file = { size: buf.length, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
    }
  } else {
    const form = await request.formData().catch((e) => {
      console.error("[avatar] could not parse upload", { accountId, contentType, length: request.headers.get("content-length"), message: e?.message });
      return null;
    });
    const f = form?.get("avatar");
    if (f && typeof f !== "string") file = f;
  }
  if (!file || !file.size) {
    return NextResponse.json({ error: "We couldn't read that photo. Please try another one.", code: "AVATAR_UNREADABLE" }, { status: 400 });
  }

  try {
    // saveAvatar uploads to object storage and returns the full public
    // URL directly — stored as-is, no proxy route needed (see
    // lib/avatars.js and lib/storage.js).
    const previous = (await getAccountById(accountId))?.avatarPath;
    const avatarUrl = await saveAvatar(accountId, file);
    await setAvatarPath(accountId, avatarUrl);
    if (previous && previous !== avatarUrl) await deleteAvatarFile(previous);
    return NextResponse.json({ avatarUrl }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e.code === "INVALID_TYPE" || e.code === "TOO_LARGE") {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    // Log enough to diagnose from the server logs (the client only ever sees a friendly message).
    console.error("[avatar] upload failed", { accountId, name: e?.name, code: e?.code || e?.Code, status: e?.$metadata?.httpStatusCode, message: e?.message });
    return NextResponse.json({ error: "Could not save your photo right now. Please try again in a moment.", code: "AVATAR_SAVE_FAILED" }, { status: 500 });
  }
}

export async function DELETE() {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });

  const account = await getAccountById(accountId);
  if (account?.avatarPath) await deleteAvatarFile(account.avatarPath);
  await clearAvatarPath(accountId);
  return NextResponse.json({ ok: true });
}
