// Storage for identity verification documents (ID photos, business
// registration docs, etc). Deliberately a SEPARATE object-storage bucket
// from lib/media.js's post media — that pipeline is public-by-design
// (anyone can view a public post's attachment); this one never is.
// Uploaded to the object storage PRIVATE bucket (see lib/storage.js),
// which 404s for anyone without a signed request. Only the storage KEY
// is ever stored in Postgres (verification_requests.document_path) —
// never a URL, since a plain URL into a private bucket wouldn't resolve
// anyway, and a signed URL would eventually expire and go stale sitting
// in a database column. A signed, time-limited URL is minted on demand,
// only for an authorized reviewer, only at the moment they need to look
// at one — see getVerificationDocumentSignedUrl() below and
// scripts/review-verification.js, the only current caller. There is no
// HTTP route that serves these documents, on purpose.
import { uploadPrivateObject, getPrivateSignedUrl } from "../storage.js";

const ALLOWED_TYPES = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
  "application/pdf": "pdf",
};
const MAX_BYTES = 12 * 1024 * 1024;

export function isAllowedDocumentType(mimeType) {
  return Object.prototype.hasOwnProperty.call(ALLOWED_TYPES, mimeType);
}

export async function saveVerificationDocument(requestId, file) {
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    const err = new Error("Unsupported file type. Upload a clear photo (PNG/JPEG) or a PDF.");
    err.code = "INVALID_TYPE";
    throw err;
  }
  if (file.size > MAX_BYTES) {
    const err = new Error(`File too large — max ${Math.round(MAX_BYTES / 1024 / 1024)}MB.`);
    err.code = "TOO_LARGE";
    throw err;
  }
  const key = `verification/${requestId}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  // uploadPrivateObject returns the key itself (not a URL) — that's what
  // gets stored in verification_requests.document_path.
  return uploadPrivateObject(key, buffer, file.type);
}

// Used only by scripts/review-verification.js. Mints a short-lived
// signed URL (default 10 minutes) an operator can open in a browser to
// view the document, after the script has already checked they're
// looking at a request they're entitled to review. Never returns a
// bare/public URL — this bucket has none.
export async function getVerificationDocumentSignedUrl(documentKey, expiresInSeconds = 600) {
  if (!documentKey) return null;
  return getPrivateSignedUrl(documentKey, expiresInSeconds);
}
