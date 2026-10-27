"use client";
import { useMemo } from "react";
import { qrMatrix } from "@/lib/qr";

// Scannable QR (SVG) — always black on white with a quiet zone so every
// authenticator app can read it in light or dark mode.
export default function QrCode({ value, size = 188 }) {
  const m = useMemo(() => { try { return qrMatrix(value); } catch { return null; } }, [value]);
  if (!m) return null;
  const n = m.length, q = 4;
  const d = [];
  m.forEach((row, r) => { let c = 0; while (c < n) { if (row[c]) { let e = c; while (e < n && row[e]) e++; d.push(`M${c + q} ${r + q}h${e - c}v1h-${e - c}z`); c = e; } else c++; } });
  return (
    <svg viewBox={`0 0 ${n + q * 2} ${n + q * 2}`} width={size} height={size} shapeRendering="crispEdges" role="img" aria-label="Authenticator QR code" style={{ background: "#fff", borderRadius: 8, display: "block" }}>
      <path d={d.join("")} fill="#000" />
    </svg>
  );
}
