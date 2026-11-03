import { C, monoFont, alpha } from "@/lib/theme";

// Apple sign-in is intentionally switched off for now (see
// ComingSoonAppleButton) — Google is the only live provider.
// Plain links, not fetch calls — these need to trigger a full-page
// redirect to Google/Apple's consent screen, which a client-side fetch
// can't do. If the corresponding provider isn't configured server-side,
// the route itself returns a graceful "not configured" JSON response
// (see app/api/auth/google/route.js and .../apple/route.js) rather than
// a broken redirect.
export default function OAuthButtons() {
  return (
    <div className="flex flex-col gap-2">
      <a
        href="/api/auth/google"
        className="flex items-center justify-center gap-2"
        style={{ ...monoFont, fontSize: 12.5, color: C.text, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 14px", textDecoration: "none" }}
      >
        <GoogleIcon /> Continue with Google
      </a>
      <ComingSoonAppleButton />
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 16 18.9 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34.6 6.1 29.6 4 24 4c-7.4 0-13.8 4.1-17.1 10.1z" />
      <path fill="#4CAF50" d="M24 44c5.5 0 10.4-1.9 14.3-5.1l-6.6-5.4C29.7 35.4 27 36.3 24 36.3c-5.3 0-9.7-3.4-11.3-8.1l-6.5 5C9.9 39.5 16.4 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.6 5.4C41.7 35.6 44 30.2 44 24c0-1.3-.1-2.7-.4-3.5z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.365 1.43c0 1.14-.468 2.19-1.235 2.955-.83.83-2.185 1.47-3.245 1.39-.135-1.11.44-2.29 1.185-3.02.83-.82 2.29-1.44 3.295-1.325zM20.5 17.02c-.545 1.27-.815 1.83-1.53 2.94-.995 1.55-2.4 3.48-4.145 3.5-1.55.02-1.95-1.03-4.05-1.02-2.1.01-2.54 1.04-4.09 1.02-1.745-.02-3.08-1.75-4.075-3.3-2.795-4.35-3.09-9.46-1.365-12.18 1.225-1.93 3.16-3.06 4.98-3.06 1.85 0 3.01 1.02 4.545 1.02 1.485 0 2.39-1.02 4.53-1.02 1.62 0 3.335.88 4.56 2.4-4.005 2.2-3.355 7.93.64 9.7z" />
    </svg>
  );
}

// Shown everywhere Apple sign-in used to be: visibly present, clearly not
// available yet, and not focusable/clickable (aria-disabled, no href).
export function ComingSoonAppleButton({ compact = false }) {
  return (
    <div
      role="button"
      aria-disabled="true"
      title="Sign in with Apple is coming soon"
      className="flex items-center justify-center gap-2"
      style={{
        ...monoFont, fontSize: compact ? 10.5 : 12.5, color: C.muted, position: "relative", cursor: "not-allowed", userSelect: "none",
        background: `linear-gradient(135deg, ${C.surface2}, ${C.surface})`, border: `1px dashed ${C.line}`, borderRadius: 8,
        padding: compact ? "6px 10px" : "10px 14px", opacity: 0.85,
      }}
    >
      <span style={{ opacity: 0.55, display: "inline-flex" }}><AppleIcon /></span>
      <span style={{ opacity: 0.7 }}>{compact ? "Apple" : "Continue with Apple"}</span>
      <span style={{ ...monoFont, fontSize: 12, letterSpacing: "0.09em", textTransform: "uppercase", fontWeight: 700, color: C.mustard, background: alpha(C.mustard, 12), border: `1px solid ${alpha(C.mustard, 35)}`, borderRadius: 999, padding: "2px 7px" }}>
        Coming soon
      </span>
    </div>
  );
}
