// Professionally styled link-preview cards (what WhatsApp, LinkedIn, X, Slack, iMessage show when a LinkedOut link is shared).
// One renderer for every kind of share: a Pulse post, an Awards (cringe board) post, a Story. 1200x630, system fonts only (no network at render time).
import { ImageResponse } from "next/og";

export const CARD_SIZE = { width: 1200, height: 630 };
const clip = (s, n) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t; };
const initials = (n) => String(n || "?").replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
const THEMES = { pulse: ["#4C61FF", "#0B0E14"], award: ["#E0A526", "#14100A"], story: ["#2E9E6B", "#0A1210"] };

export function renderCard({ kind = "pulse", kicker, text, author, stats = [], footer = "linkedoutnetwork.com", badge }) {
  const [accent, bg] = THEMES[kind] || THEMES.pulse;
  const body = clip(text, 230), size = body.length > 150 ? 44 : body.length > 80 ? 54 : 64;
  return new ImageResponse(
    (<div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: `linear-gradient(135deg, ${bg} 0%, #121826 100%)`, color: "#F4F6FB", fontFamily: "sans-serif", position: "relative" }}>
      <div style={{ display: "flex", height: 10, width: "100%", background: accent }} />
      <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "52px 72px 44px", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 46, height: 46, borderRadius: 12, background: accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 800, color: "#0B0E14" }}>L</div>
            <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: 1 }}>LinkedOut</div>
          </div>
          <div style={{ display: "flex", fontSize: 22, color: accent, textTransform: "uppercase", letterSpacing: 3, fontWeight: 700 }}>{kicker}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {badge ? <div style={{ display: "flex", alignSelf: "flex-start", marginBottom: 22, padding: "8px 18px", borderRadius: 999, background: accent, color: "#0B0E14", fontSize: 24, fontWeight: 800 }}>{badge}</div> : null}
          <div style={{ display: "flex", fontSize: size, fontWeight: 700, lineHeight: 1.18, letterSpacing: -0.5 }}>{`“${body}”`}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 56, height: 56, borderRadius: 28, background: "#1E2636", border: `2px solid ${accent}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 700 }}>{initials(author)}</div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{clip(author, 32)}</div>
              <div style={{ display: "flex", fontSize: 22, color: "#AAB3C7", gap: 18 }}>{stats.filter(Boolean).map((x, i) => <span key={i}>{x}</span>)}</div>
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 24, color: "#7F8AA3" }}>{footer}</div>
        </div>
      </div>
    </div>), CARD_SIZE);
}
export const cardMeta = (title, description, path) => ({
  title, description,
  openGraph: { title, description, type: "article", siteName: "LinkedOut", url: path },
  twitter: { card: "summary_large_image", title, description },
});
