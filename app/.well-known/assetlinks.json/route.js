import { NextResponse } from "next/server";

// Served at https://<domain>/.well-known/assetlinks.json — Android's
// equivalent of apple-app-site-association, for App Links. REPLACE
// "sha256_cert_fingerprints" with your real signing certificate's SHA-256
// fingerprint before this verifies (get it from `eas credentials`, or
// `keytool -list -v` on your keystore for a manual build — it's a
// colon-separated hex string). Until it's real, Android links keep
// opening in the browser instead of the app — harmless fallback, not a
// crash.
export async function GET() {
<<<<<<< HEAD
  // App Links for the directly distributed APK: include every official signing certificate registered for distribution
  // (Admin -> Update & Integrity Policy, or DIST_APK_CERTS), so links open the app on directly installed copies too.
  let fromDist = []; try { const { officialCerts } = await import("@/lib/distribution/db"); const { colonHex } = await import("@/lib/distribution/canon"); fromDist = (await officialCerts()).map(colonHex); } catch { /* distribution not set up */ }
  const certs = [...new Set([...(process.env.ANDROID_SHA256_FINGERPRINTS || "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean), ...fromDist])];
=======
>>>>>>> origin/main
  return NextResponse.json([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: process.env.ANDROID_PACKAGE_NAME || "com.linkedoutnetwork.linkedout",
        // Comma-separated SHA-256 fingerprints. Once the app is on Play with Play App Signing, add the
        // "App signing key certificate" from Play Console (Release > Setup > App signing) AND your upload key.
<<<<<<< HEAD
        sha256_cert_fingerprints: certs,
=======
        sha256_cert_fingerprints: (process.env.ANDROID_SHA256_FINGERPRINTS || "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean),
>>>>>>> origin/main
      },
    },
  ]);
}
