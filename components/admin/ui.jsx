"use client";
import { C, monoFont } from "@/lib/theme";

// Admin design primitives — same tokens as the product, tuned for density.
export const card = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18, padding: 18, boxShadow: "var(--lo-shadow-1)" };
export const btn = (kind) => ({
  background: kind === "primary" ? "var(--lo-grad)" : kind === "danger" ? "transparent" : C.surface2,
  color: kind === "primary" ? "#fff" : kind === "danger" ? C.flag : C.text,
  border: `1px solid ${kind === "primary" ? "transparent" : kind === "danger" ? "color-mix(in srgb, var(--lo-flag) 45%, transparent)" : C.line2}`,
  borderRadius: 9, padding: "7px 13px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", minHeight: 34,
});
export const inputStyle = { background: C.surface2, color: C.text, border: `1px solid ${C.line2}`, borderRadius: 10, padding: "9px 12px", fontSize: 14.5, width: "100%", minHeight: 40 };

export function Stat({ label, value, tone, hint }) {
  return (
    <div className="lo-adm-card lo-rise" style={{ ...card, padding: "14px 16px", position: "relative", overflow: "hidden" }}>
      <div aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: tone || "var(--lo-grad)", opacity: tone ? 1 : 0.55 }} />
      <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, letterSpacing: "0.01em" }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.1, color: tone || C.text, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>{typeof value === "number" ? value.toLocaleString() : value}</div>
      {hint ? <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{hint}</div> : null}
    </div>
  );
}

// Pulsing green dot = someone is here right now. off = seen recently, not live.
export function LiveDot({ off, size, title }) {
  return <span className="lo-live-dot" data-off={off ? "true" : undefined} data-size={size} title={title || (off ? "Offline" : "Active now")} role="img" aria-label={off ? "Offline" : "Active now"} />;
}

export function SectionHeading({ children, right }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, margin: "26px 0 10px" }}>
      <h2 style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: C.muted, margin: 0 }}>{children}</h2>
      <div aria-hidden style={{ flex: 1, height: 1, background: C.line, marginLeft: 6 }} />
      {right}
    </div>
  );
}
export function Pill({ children }) {
  const t = String(children);
  const tone = /active|verified|approved|healthy|ok|accepted|complied|actioned|resolved|configured|public|live|on\b/.test(t) ? "green" : /suspend|ban|lock|reject|removed|revoked|missing|down|pending|open|high|off\b/.test(t) ? "flag" : "accent";
  const c = tone === "green" ? C.green : tone === "flag" ? C.flag : C.mustard;
  return <span style={{ display: "inline-flex", alignItems: "center", fontSize: 12.5, fontWeight: 600, color: c, background: `color-mix(in srgb, ${c} 14%, transparent)`, borderRadius: 6, padding: "2px 8px", whiteSpace: "nowrap" }}>{t}</span>;
}
let sparkId = 0;
export function Sparkline({ data, height = 56 }) {
  const id = `spk${++sparkId}`;
  const max = Math.max(1, ...data), w = 200;
  const xy = data.map((v, i) => [(i / Math.max(1, data.length - 1)) * w, height - 5 - (v / max) * (height - 12)]);
  const pts = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = xy[xy.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ width: "100%", height, display: "block" }} aria-hidden>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--lo-mustard)" stopOpacity="0.32" /><stop offset="100%" stopColor="var(--lo-mustard)" stopOpacity="0" /></linearGradient></defs>
      {xy.length > 1 && <polygon points={`0,${height} ${pts} ${w},${height}`} fill={`url(#${id})`} />}
      <polyline points={pts} fill="none" stroke="var(--lo-mustard)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {last && <circle cx={last[0]} cy={last[1]} r="3" fill="var(--lo-mustard)" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}
