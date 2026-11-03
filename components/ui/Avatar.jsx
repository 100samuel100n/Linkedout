"use client";
import VerifiedTick from "@/components/VerifiedTick";

// Consistent avatar: image or tinted initial, optional presence dot and tier ring.
export default function Avatar({ src, name = "?", size = 40, online = false, tier, anonymous = false }) {
  const ring = tier === "pro" ? "0 0 0 2px var(--lo-surface), 0 0 0 4px #E3A93B" : tier === "plus" ? "0 0 0 2px var(--lo-surface), 0 0 0 4px #4D8DFF" : "none";
  return (
    <span style={{ position: "relative", display: "inline-flex", width: size, height: size, flexShrink: 0 }}>
      {src ? <img src={src} alt="" width={size} height={size} style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", boxShadow: ring, background: "var(--lo-surface2)" }} />
        : <span aria-hidden="true" style={{ width: size, height: size, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--lo-surface3)", color: "var(--lo-text2)", fontWeight: 700, fontSize: Math.round(size * 0.4), boxShadow: ring }}>{anonymous ? "?" : (name || "?").trim()[0]?.toUpperCase()}</span>}
      {online && <span style={{ position: "absolute", right: 0, bottom: 0, width: Math.max(9, size * 0.24), height: Math.max(9, size * 0.24), borderRadius: "50%", background: "var(--lo-green)", border: "2px solid var(--lo-surface)" }} />}
    </span>
  );
}
export { VerifiedTick };
