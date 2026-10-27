"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { C, monoFont, displayFont, alpha } from "@/lib/theme";

// Only http(s) destinations are ever followed; anything else is ignored.
function safeUrl(u) {
  try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:" ? x.href : null; } catch { return null; }
}
const HEX = /^#[0-9a-fA-F]{6}$/;
const col = (v) => (typeof v === "string" && HEX.test(v) ? v : null);

const beacon = (adId, kind) => { if (adId != null) fetch("/api/ads/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adId, kind }), keepalive: true }).catch(() => {}); };

// A direct (admin-managed) ad. Appearance comes from the ad itself (layout,
// colours, corner radius, label, image) with the admin's global defaults as
// fallback. "page" ads open a full landing page inside the app instead of an
// external link.
export default function AdCard({ ad, label = "Sponsored", defaultLayout = "card" }) {
  const isPage = ad.format === "page" && ad.page;
  const href = isPage ? `/ad/${ad.id}` : ad.url ? safeUrl(ad.url) : null;
  const ref = useRef(null), seen = useRef(false);
  useEffect(() => {
    const el = ref.current; if (!el || seen.current || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting && !seen.current) { seen.current = true; beacon(ad.id, "impression"); io.disconnect(); } }, { threshold: 0.5 });
    io.observe(el); return () => io.disconnect();
  }, [ad.id]);

  const layout = ad.layout || defaultLayout;
  const bg = col(ad.bg_color), fg = col(ad.text_color), accent = col(ad.accent_color) || C.corpblue;
  const muted = fg ? alpha(fg, 75) : C.muted;
  const radius = Number.isFinite(ad.radius) ? ad.radius : 14;
  const initial = (ad.brand || "?").trim()[0]?.toUpperCase();
  const cta = ad.cta || (isPage ? "Learn more" : href ? "Learn more" : null);
  const image = ad.image_url && safeUrl(ad.image_url);

  const Cta = href && cta ? (
    isPage ? (
      <Link href={href} onClick={() => beacon(ad.id, "click")} style={{ ...monoFont, fontSize: 12, color: "#fff", background: accent, borderRadius: 8, padding: "8px 14px", alignSelf: "flex-start", textDecoration: "none", fontWeight: 600 }}>{cta}</Link>
    ) : (
      <a href={href} onClick={() => beacon(ad.id, "click")} target="_blank" rel="sponsored noopener noreferrer" style={{ ...monoFont, fontSize: 12, color: "#fff", background: accent, borderRadius: 8, padding: "8px 14px", alignSelf: "flex-start", textDecoration: "none", fontWeight: 600 }}>{cta}</a>
    )
  ) : null;

  const Header = (
    <div className="flex items-center justify-between">
      <span style={{ ...monoFont, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: muted }}>{ad.label || label}</span>
      <Link href="/premium" style={{ ...monoFont, fontSize: 12, color: muted, textDecoration: "none", border: `1px solid ${fg ? alpha(fg, 30) : C.line}`, borderRadius: 999, padding: "2px 9px" }}>Go ad-free</Link>
    </div>
  );
  const Mark = (
    <div aria-hidden="true" style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 16, background: `linear-gradient(135deg, ${accent}, ${alpha(accent, 60)})` }}>{initial}</div>
  );
  const Text = (
    <div style={{ minWidth: 0 }}>
      <div style={{ ...displayFont, fontSize: 14.5, color: fg || C.text }}>{ad.brand}</div>
      <p style={{ fontSize: 13, color: muted, lineHeight: 1.5, marginTop: 3 }}>{ad.tagline}</p>
    </div>
  );
  const box = { background: bg || C.surface, border: `1px solid ${bg ? alpha(fg || "#ffffff", 20) : C.line}`, borderRadius: radius, boxShadow: bg ? "none" : `inset 3px 0 0 ${alpha(accent, 45)}`, overflow: "hidden" };

  if (layout === "hero") {
    return (
      <div ref={ref} className="flex flex-col" style={box}>
        {image && <img src={image} alt="" loading="lazy" style={{ width: "100%", maxHeight: 220, objectFit: "cover", display: "block" }} />}
        <div className="p-4 flex flex-col gap-3">{Header}{Text}{Cta}</div>
      </div>
    );
  }
  if (layout === "banner") {
    return (
      <div ref={ref} className="p-3 flex items-center gap-3 flex-wrap" style={box}>
        {image ? <img src={image} alt="" loading="lazy" style={{ width: 56, height: 56, borderRadius: Math.min(radius, 12), objectFit: "cover" }} /> : Mark}
        <div style={{ flex: 1, minWidth: 160 }}>
          <span style={{ ...monoFont, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: muted }}>{ad.label || label}</span>
          {Text}
        </div>
        {Cta}
      </div>
    );
  }
  return (
    <div ref={ref} className="p-4 flex flex-col gap-3" style={box}>
      {Header}
      <div className="flex items-start gap-3">{image ? <img src={image} alt="" loading="lazy" style={{ width: 56, height: 56, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} /> : Mark}{Text}</div>
      {Cta}
    </div>
  );
}
