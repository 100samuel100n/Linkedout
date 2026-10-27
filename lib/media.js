// Post media storage — images, video, documents, voice notes. Uploaded
// straight to the object storage PUBLIC bucket (see lib/storage.js) —
// post/comment media is public-by-design, so there's no proxy route
// serving it: savePostMedia() returns the full public URL, which gets
// stored directly in Postgres (posts.media_path / comments.media_path —
// see lib/content/db.js's rowToPost/rowToComment) and handed straight to
// the client. The 200MB-video walkthrough this migration was built
// around is exactly this file: authenticate → validate → upload to
// storage → get back a URL → store the URL, never the bytes, in the
// database.
//
// Video and audio are run through lib/transcode.js when a system ffmpeg
// binary is available — this normalizes format and caps size (see that
// file for the exact settings) rather than storing/serving whatever
// codec and resolution someone happened to upload. Falls back to storing
// the original bytes untouched when ffmpeg isn't available or a specific
// file fails to transcode; that fallback must never block a post.
import { transcodeVideo, transcodeAudio } from "./transcode.js";
import { uploadPublicObject } from "./storage.js";

const ALLOWED_TYPES = {
  "image/png": { ext: "png", kind: "image" },
  "image/jpeg": { ext: "jpg", kind: "image" },
  "image/webp": { ext: "webp", kind: "image" },
  "image/gif": { ext: "gif", kind: "image" },
  "video/mp4": { ext: "mp4", kind: "video" },
  "video/quicktime": { ext: "mov", kind: "video" },
  "video/webm": { ext: "webm", kind: "video" },
  "audio/mpeg": { ext: "mp3", kind: "audio" },
  "audio/mp4": { ext: "m4a", kind: "audio" },
  "audio/wav": { ext: "wav", kind: "audio" },
  "audio/webm": { ext: "webm", kind: "audio" },
  "application/pdf": { ext: "pdf", kind: "document" },
  "application/msword": { ext: "doc", kind: "document" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: "docx", kind: "document" },
};

const CONTENT_TYPE_BY_EXT = Object.fromEntries(
  Object.entries(ALLOWED_TYPES).map(([mime, meta]) => [meta.ext, mime])
);

// Different limits per kind — a voice note or PDF is small, video needs
// real headroom. These caps apply to the ORIGINAL upload, before
// transcoding shrinks video/audio further — a real ffmpeg pass routinely
// cuts a voice note to under a tenth of its original size (verified: a
// 172KB WAV test clip came out as a 25KB AAC file), so the stored file
// is typically well under these numbers even at the upload limit.
const MAX_BYTES = { image: 8 * 1024 * 1024, audio: 15 * 1024 * 1024, document: 15 * 1024 * 1024, video: 100 * 1024 * 1024 };

export function isAllowedMediaType(mimeType) {
  return Object.prototype.hasOwnProperty.call(ALLOWED_TYPES, mimeType);
}

export function getMediaKind(mimeType) {
  return ALLOWED_TYPES[mimeType]?.kind || null;
}

// postId is used as the object key's basename (e.g. "posts/<postId>.mp4")
// — every upload gets a fresh, unique path because post/comment ids are
// UUIDs, so nothing ever needs to be deleted-then-replaced here the way
// avatars do (see lib/avatars.js).
export async function savePostMedia(postId, file) {
  const meta = ALLOWED_TYPES[file.type];
  if (!meta) {
    const err = new Error("Unsupported file type. Allowed: images, mp4/mov/webm video, mp3/m4a/wav/webm audio, PDF/DOC/DOCX.");
    err.code = "INVALID_TYPE";
    throw err;
  }
  const limit = MAX_BYTES[meta.kind];
  if (file.size > limit) {
    const err = new Error(`File too large for ${meta.kind} — max ${Math.round(limit / 1024 / 1024)}MB.`);
    err.code = "TOO_LARGE";
    throw err;
  }

  let buffer = Buffer.from(await file.arrayBuffer());
  let ext = meta.ext;

  if (meta.kind === "video") {
    const result = await transcodeVideo(buffer, meta.ext);
    if (result) { buffer = result.buffer; ext = result.ext; }
  } else if (meta.kind === "audio") {
    const result = await transcodeAudio(buffer, meta.ext);
    if (result) { buffer = result.buffer; ext = result.ext; }
  }

  const key = `posts/${postId}.${ext}`;
  const url = await uploadPublicObject(key, buffer, CONTENT_TYPE_BY_EXT[ext] || file.type);
  return { url, kind: meta.kind };
}

// Used only by scripts/seed-content.js — bypasses the File-shaped input
// savePostMedia() expects, since seeding builds an image buffer directly
// (either a real fetched photo or a generated placeholder — see
// scripts/lib/stock-photos.js and scripts/lib/placeholder-avatar.js)
// rather than uploading a real browser File. contentType defaults to PNG
// for backward compatibility with the placeholder path; real fetched
// photos pass "image/jpeg".
export async function saveGeneratedMedia(postId, buffer, contentType = "image/png") {
  const ext = contentType === "image/jpeg" ? "jpg" : "png";
  const key = `posts/${postId}.${ext}`;
  return uploadPublicObject(key, buffer, contentType);
}
