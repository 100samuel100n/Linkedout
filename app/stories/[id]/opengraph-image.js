import { ImageResponse } from "next/og";
import { getStory } from "@/lib/stories/service";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "A story on LinkedOut";
export default async function Image({ params }) {
  const { id } = await params;
  const s = await getStory(id, null).catch(() => null);
  const title = (s?.title || s?.body || "A story on LinkedOut").slice(0, 120);
  return new ImageResponse(
    (<div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "#0B0E14", color: "#F4F6FB" }}>
      <div style={{ fontSize: 28, color: "#E0A526", textTransform: "uppercase", letterSpacing: 3 }}>{s?.formatLabel || "Story"}{s?.company ? ` · ${s.company}` : ""}</div>
      <div style={{ fontSize: 64, fontWeight: 760, lineHeight: 1.15 }}>{title}</div>
      <div style={{ fontSize: 30, color: "#AAB3C7", display: "flex", justifyContent: "space-between" }}><span>{s?.counts?.total ? `${s.counts.total} people say this happened to them too` : "First-hand account"}</span><span>LinkedOut</span></div>
    </div>), size);
}
