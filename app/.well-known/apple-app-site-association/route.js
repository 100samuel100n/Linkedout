import { NextResponse } from "next/server";

// Served at https://<domain>/.well-known/apple-app-site-association —
// the exact path and extensionless filename iOS requires to verify
// Universal Links (tapping a linkedout.app link opens the app directly,
// no browser interstitial). REPLACE THE PLACEHOLDERS before this does
// anything: "TEAMID" is your Apple Developer Team ID (Apple Developer
// portal → Membership), and the bundle id must match app.json's
// ios.bundleIdentifier in linkedout-native. Until both are real, iOS
// will simply fail verification silently and links keep opening in
// Safari instead — that fallback is harmless, not a crash.
export async function GET() {
  return NextResponse.json({
    applinks: {
      apps: [],
      details: [
        {
          appID: `${process.env.APPLE_TEAM_ID || "TEAMID"}.${process.env.IOS_BUNDLE_ID || "com.linkedoutnetwork.linkedout"}`,
          paths: ["/reset-password", "/post/*", "/u/*", "/login", "/signup"],
        },
      ],
    },
  });
}
