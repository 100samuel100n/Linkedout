// Avatar storage — uploaded to the object storage PUBLIC bucket (see
// lib/storage.js). saveAvatar() returns the full public URL, stored
// directly in accounts.avatar_path (see lib/identity/service.js) and
// handed straight to clients — no proxy route needed, same reasoning as
// lib/media.js.
import { uploadPublicObject, deletePublicObject, keyFromPublicUrl } from "./storage.js";

const ALLOWED_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MAX_BYTES = 10 * 1024 * 1024; // 10MB: phone photos are routinely 4-8MB

export function isAllowedAvatarType(mimeType) {
  return Object.prototype.hasOwnProperty.call(ALLOWED_TYPES, mimeType);
}

export const AVATAR_MAX_BYTES = MAX_BYTES;

// Removes any previously-stored avatar object for this account,
// regardless of extension (a user might upload a .png, delete it, then
// upload a .webp — old objects shouldn't linger in the bucket).
async function removeExistingAvatarObjects(accountId) {
  await Promise.all(
    Object.values(ALLOWED_TYPES).map((ext) => deletePublicObject(`avatars/${accountId}.${ext}`).catch(() => {}))
  );
}

// Identify the real image type from its first bytes. Phones and some HTTP clients send a wrong
// or empty content type (application/octet-stream, image/jpg, extension-based guesses), which used
// to make perfectly good photos fail with a generic error.
export function sniffImageType(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length > 12 && buf.slice(0, 4).toString("latin1") === "RIFF" && buf.slice(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

export async function saveAvatar(accountId, file) {
  if (file.size > MAX_BYTES) {
    const err = new Error("That photo is too large. Choose one under 10MB.");
    err.code = "TOO_LARGE";
    throw err;
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const detected = sniffImageType(buffer);
  if (!detected) {
    const err = new Error("Use a JPEG, PNG or WebP photo. (iPhone HEIC photos need to be converted or shared as JPEG.)");
    err.code = "INVALID_TYPE";
    throw err;
  }
  file = { type: detected, size: buffer.length, arrayBuffer: async () => buffer };
  // A fresh key per upload: re-using one fixed key meant the public URL never
  // changed, so browsers and CDNs kept showing the old picture after a change.
  // The caller removes the previous object once the new one is saved.
  const ext = ALLOWED_TYPES[file.type];
  const key = `avatars/${accountId}-${Date.now().toString(36)}.${ext}`;
  return uploadPublicObject(key, buffer, file.type);
}

// avatarUrl is the full public URL previously returned by saveAvatar
// (stored as-is in accounts.avatar_path) — recovers the storage key from
// it so the object can actually be removed.
export async function deleteAvatarFile(avatarUrl) {
  const key = keyFromPublicUrl(avatarUrl);
  if (!key) return;
  await deletePublicObject(key).catch(() => {});
}

// Used only by scripts/seed-content.js, for the generated placeholder
// avatars in scripts/lib/placeholder-avatar.js — bypasses the File-shaped
// input saveAvatar() expects since seeding builds a PNG buffer directly,
// not a browser File.
export async function saveGeneratedAvatar(accountId, buffer, contentType = "image/png") {
  await removeExistingAvatarObjects(accountId);
  const ext = contentType === "image/jpeg" ? "jpg" : "png";
  const key = `avatars/${accountId}.${ext}`;
  return uploadPublicObject(key, buffer, contentType);
}
