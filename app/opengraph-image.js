import { ImageResponse } from "next/og";
export const alt = "LinkedOut: the truth about work";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export default function Image() {
  return new ImageResponse(
    (<div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, background: "#0B0E14", color: "#F4F6FB" }}>
      <div style={{ fontSize: 28, color: "#E0A526", letterSpacing: 4, textTransform: "uppercase" }}>The workplace truth feed</div>
      <div style={{ fontSize: 96, fontWeight: 800, marginTop: 18, lineHeight: 1.05 }}>LinkedOut</div>
      <div style={{ fontSize: 40, color: "#AAB3C7", marginTop: 24 }}>Real stories about layoffs, bad bosses and what employees actually say.</div>
    </div>), size);
}
