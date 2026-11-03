import { NextResponse } from "next/server";
import { identityDb } from "@/lib/identity/db";
import { distReady, uid, now, J, bumpManifest, officialCerts } from "@/lib/distribution/db";
import { timingEq, normHex } from "@/lib/distribution/canon";
import { fail } from "@/lib/distribution/http";
// For your release script (scripts/dist-release.mjs): registers a build as a DRAFT. Publishing stays a human click in
// Admin -> Releases & Updates. Authenticated with DIST_RELEASE_TOKEN, not a user session.
export async function POST(request) {
  try {
    const tok = process.env.DIST_RELEASE_TOKEN || ""; const got = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
    if (tok.length < 24 || !timingEq(got, tok)) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const b = await request.json().catch(() => null); if (!b) return NextResponse.json({ error: "Bad request." }, { status: 400 });
    const sha = normHex(b.sha256).toLowerCase(), code = Math.round(+b.versionCode); const url = new URL(b.url); if (url.protocol !== "https:") throw Object.assign(new Error("url must be https"), { status: 400 });
    if (sha.length !== 64 || !(code > 0) || !b.versionName) throw Object.assign(new Error("versionName, versionCode, sha256 and url are required."), { status: 400 });
    const cert = b.certSha256 ? normHex(b.certSha256).toLowerCase() : null; const certs = await officialCerts();
    if (cert && certs.length && !certs.includes(cert.toUpperCase())) throw Object.assign(new Error("This APK is signed with a certificate that is not in the official list."), { status: 409 });
    await distReady();
    await identityDb.prepare("INSERT INTO dist_releases (id, version_name, version_code, sha256, size_bytes, cert_sha256, url, mirror_urls, notes, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(uid(), String(b.versionName).slice(0, 24), code, sha, b.sizeBytes ? Math.round(+b.sizeBytes) : null, cert, url.toString(), J(Array.isArray(b.mirrorUrls) ? b.mirrorUrls.filter((u) => /^https:\/\//.test(u)).slice(0, 8) : []), String(b.notes || "").slice(0, 2000), "draft", "ci", now());
    await bumpManifest();
    return NextResponse.json({ ok: true, status: "draft", next: "Publish it in Admin -> Releases & Updates." });
  } catch (e) { if (/UNIQUE|duplicate key/i.test(e?.message || "")) return NextResponse.json({ error: "That version code is already registered." }, { status: 409 }); return fail(e); }
}
