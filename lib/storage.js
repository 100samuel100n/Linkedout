// Object storage — Backblaze B2, via its S3-compatible API.
//
// Two buckets, two trust levels:
//   - PUBLIC bucket: post/comment media, avatars. Anyone with the URL can
//     view it — that's the point (this is exactly what a public feed
//     needs). Uploaded here, the app stores the resulting URL directly
//     in Postgres (posts.media_path, accounts.avatar_path, etc.) and
//     never touches this module again to serve it — the client's
//     browser/app hits the B2 URL (or your CDN in front of it) directly.
//   - PRIVATE bucket: government-ID / business / professional
//     verification documents. B2's "Private" bucket setting means the
//     object 404s for anyone without a signed request — there is no
//     public URL for these, ever. The app stores only the storage KEY in
//     Postgres (verification_requests.document_path), and mints a
//     short-lived signed URL on demand, only for an authorized reviewer,
//     only at the moment they need to look at one — see
//     lib/identity/documents.js and scripts/review-verification.js. This
//     is the "Admin → backend authorization → signed URL → Private
//     Storage" flow.
//
// Why B2 over S3 itself: B2's storage price and (more importantly) its
// egress price are both a fraction of S3's, and every popular CDN
// (Cloudflare, Fastly, bunny.net) either peers with B2 for free egress
// or fronts it directly — see DEPLOYMENT.md's Object Storage section for
// the exact setup. Nothing here is B2-specific at the API level (it's
// the plain AWS SDK v3 S3 client against a different endpoint), so
// swapping to real S3, Cloudflare R2, or DigitalOcean Spaces later is a
// two-env-var change, not a code change.
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `${name} is not set. Object storage (Backblaze B2) needs it — see .env.local.example and DEPLOYMENT.md's Object Storage section.`
    );
  }
  return v;
}

let client = null;
function getClient() {
  if (client) return client;
  client = new S3Client({
    endpoint: requireEnv("B2_ENDPOINT"), // e.g. https://s3.us-west-004.backblazeb2.com
    region: process.env.B2_REGION || "us-west-004",
    credentials: {
      accessKeyId: requireEnv("B2_KEY_ID"),
      secretAccessKey: requireEnv("B2_APPLICATION_KEY"),
    },
    // B2's S3-compatible endpoint wants virtual-hosted-style disabled —
    // this is the one B2-specific quirk in this whole file.
    forcePathStyle: true,
    // Newer @aws-sdk/client-s3 releases add CRC32 checksum headers/trailers to every upload by
    // default. Backblaze B2's S3 API rejects those, so uploads fail (with a 500) after an
    // `npm install` pulls a newer SDK. Only send checksums when an operation requires them.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return client;
}

const PUBLIC_BUCKET = () => requireEnv("B2_BUCKET_PUBLIC");
const PRIVATE_BUCKET = () => requireEnv("B2_BUCKET_PRIVATE");

// The URL a browser/app can hit directly for something in the public
// bucket. Defaults to B2's own "friendly URL" for the bucket; set
// B2_PUBLIC_URL_BASE to a CDN or custom domain in front of it instead
// (e.g. https://media.yourdomain.com) once you've set that up — see
// DEPLOYMENT.md. Either way, this is the only place that URL shape is
// decided, so switching CDNs later never touches stored data (the DB
// only ever stores the full URL built at upload time — if you switch
// B2_PUBLIC_URL_BASE later, already-stored URLs keep pointing at the old
// host, which still works as long as that host is still reachable).
function publicUrlFor(key) {
  const base = process.env.B2_PUBLIC_URL_BASE;
  if (base) return `${base.replace(/\/$/, "")}/${key}`;
  // B2's native public URL shape for an S3-compatible endpoint:
  // https://<endpoint-host>/<bucket>/<key> (path-style, matching
  // forcePathStyle above).
  const endpoint = requireEnv("B2_ENDPOINT").replace(/\/$/, "");
  return `${endpoint}/${PUBLIC_BUCKET()}/${key}`;
}

// ---- Public bucket: post/comment media, avatars ----

export async function uploadPublicObject(key, buffer, contentType) {
  await getClient().send(new PutObjectCommand({
    Bucket: PUBLIC_BUCKET(),
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));
  return publicUrlFor(key);
}

export async function deletePublicObject(key) {
  await getClient().send(new DeleteObjectCommand({ Bucket: PUBLIC_BUCKET(), Key: key }));
}

// Given a full public URL previously returned by uploadPublicObject,
// recovers the storage key — needed when replacing/deleting an object
// (e.g. a new avatar upload replacing an old one) when only the URL was
// kept around (as in accounts.avatar_path).
export function keyFromPublicUrl(url) {
  if (!url) return null;
  const base = process.env.B2_PUBLIC_URL_BASE;
  if (base && url.startsWith(base)) return url.slice(base.replace(/\/$/, "").length + 1);
  const endpoint = (process.env.B2_ENDPOINT || "").replace(/\/$/, "");
  const prefix = `${endpoint}/${process.env.B2_BUCKET_PUBLIC}/`;
  if (url.startsWith(prefix)) return url.slice(prefix.length);
  return null;
}

// ---- Private bucket: verification documents ----
// No public-URL helper exists for this bucket on purpose — the only way
// out is a signed, time-limited URL, minted below.

export async function uploadPrivateObject(key, buffer, contentType) {
  await getClient().send(new PutObjectCommand({
    Bucket: PRIVATE_BUCKET(),
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));
  return key; // callers store the KEY, never a URL — see lib/identity/documents.js
}

export async function deletePrivateObject(key) {
  await getClient().send(new DeleteObjectCommand({ Bucket: PRIVATE_BUCKET(), Key: key }));
}

// Mints a temporary URL good for `expiresInSeconds` (default 10 minutes)
// that can read this one private object and nothing else. This is the
// "Backend authorization → signed URL" step in the private-storage flow
// — call this only after checking the caller is actually allowed to see
// the document (see scripts/review-verification.js, the only current
// caller).
export async function getPrivateSignedUrl(key, expiresInSeconds = 600) {
  const command = new GetObjectCommand({ Bucket: PRIVATE_BUCKET(), Key: key });
  return getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds });
}

// Used at startup (see instrumentation.js) to fail fast with a clear
// error if credentials/bucket names are wrong, rather than the first
// upload failing confusingly deep inside a request handler.
export async function verifyStorageConfig() {
  const c = getClient();
  await c.send(new HeadBucketCommand({ Bucket: PUBLIC_BUCKET() }));
  await c.send(new HeadBucketCommand({ Bucket: PRIVATE_BUCKET() }));
}
