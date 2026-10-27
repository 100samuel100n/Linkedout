"use client";
import { C, displayFont } from "@/lib/theme";

// "Android app on the way" notice. Once the app is live, set NEXT_PUBLIC_PLAY_STORE_URL to its
// Google Play link and this turns into a "Get it on Google Play" button on every page it appears.
// (Use Google's official badge artwork once you're live: https://play.google.com/intl/en_us/badges/)
const URL = process.env.NEXT_PUBLIC_PLAY_STORE_URL || "";

function PlayGlyph({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M4.2 2.6c-.3.2-.5.6-.5 1.1v16.6c0 .5.2.9.5 1.1l9.3-9.4L4.2 2.6z" fill="#2BD1FF" />
      <path d="M16.6 15.2l-3.1-3.1 3.1-3.1 3.6 2c1 .6 1 1.5 0 2.1l-3.6 2.1z" fill="#FFC800" />
      <path d="M13.5 12.1L4.2 21.4c.4.4 1 .4 1.7 0l10.7-6.2-3.1-3.1z" fill="#FF3A44" />
      <path d="M13.5 12.1l3.1-3.1L5.9 2.8c-.7-.4-1.3-.4-1.7-.2l9.3 9.5z" fill="#2DE08B" />
    </svg>
  );
}

// variant: "card" (side panel) | "line" (compact, under forms) | "banner" (wide, landing areas)
export default function PlayStoreSoon({ variant = "card", style }) {
  const live = !!URL;
  const Wrapper = live ? "a" : "div";
  const link = live ? { href: URL, target: "_blank", rel: "noopener noreferrer", "aria-label": "Get LinkedOut on Google Play" } : { role: "note" };

  if (variant === "line") {
    return (
      <Wrapper {...link} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.muted, textDecoration: "none", ...style }}>
        <PlayGlyph size={16} />
        <span>{live ? <b style={{ color: C.text }}>Get the Android app on Google Play</b> : <>Android app <b style={{ color: C.text }}>coming soon</b> to Google Play</>}</span>
      </Wrapper>
    );
  }

  return (
    <Wrapper {...link} className={live ? "lo-tap" : undefined} style={{ display: "flex", alignItems: "center", gap: 14, textDecoration: "none", background: `linear-gradient(135deg, color-mix(in srgb, var(--lo-mustard) 14%, ${C.surface}), ${C.surface} 70%)`, border: `1px solid ${C.line}`, borderRadius: 16, padding: variant === "banner" ? "16px 20px" : 16, ...style }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: C.surface2, border: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><PlayGlyph size={24} /></div>
      <div style={{ minWidth: 0, flex: 1 }}>
        {!live && <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: C.mustard, marginBottom: 2 }}>Coming soon</div>}
        <div style={{ ...displayFont, fontSize: 15.5, color: C.text, lineHeight: 1.25 }}>{live ? "Get LinkedOut on Google Play" : "LinkedOut for Android"}</div>
        <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.45, marginTop: 2 }}>{live ? "Download the app and take your stories with you." : "The app is on its way to Google Play. Use LinkedOut in your browser in the meantime."}</div>
      </div>
    </Wrapper>
  );
}
