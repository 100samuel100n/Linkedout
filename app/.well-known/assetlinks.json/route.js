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
  return NextResponse.json([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: process.env.ANDROID_PACKAGE_NAME || "com.linkedoutnetwork.linkedout",
        // Comma-separated SHA-256 fingerprints. Once the app is on Play with Play App Signing, add the
        // "App signing key certificate" from Play Console (Release > Setup > App signing) AND your upload key.
        sha256_cert_fingerprints: (process.env.ANDROID_SHA256_FINGERPRINTS || "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean),
      },
    },
  ]);
}
