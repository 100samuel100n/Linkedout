"use client";
import { AlertCircle } from "lucide-react";
import { C, alpha } from "@/lib/theme";

// One friendly inline notice for every user-facing error: soft tinted card with a round icon and plain text
// (not monospace, not raw red). Long or technical text is trimmed to two short sentences.
function brief(text) {
  const t = String(text ?? "").trim();
  if (!t) return "Something went wrong. Please try again.";
  const parts = t.split(/(?<=[.!?])\s/);
  let out = parts[0];
  if (parts[1] && (out + " " + parts[1]).length <= 200) out += " " + parts[1];
  return out.length > 200 ? out.slice(0, 197).trimEnd() + "…" : out;
}

export default function ErrorNote({ children, compact = false, title, onRetry, tone = "error" }) {
  const accent = tone === "info" ? C.mustard : C.flag;
  return (
    <div role="alert" style={{ display: "flex", alignItems: "flex-start", gap: 10, background: alpha(accent, 9), border: `1px solid ${alpha(accent, 30)}`, borderRadius: 12, padding: compact ? "6px 10px" : "10px 12px", color: C.text, fontSize: 13.5, lineHeight: 1.45 }}>
      <span style={{ width: 22, height: 22, borderRadius: 11, background: alpha(accent, 18), display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}><AlertCircle size={14} style={{ color: accent }} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        {title && <b style={{ display: "block", marginBottom: 1 }}>{title}</b>}
        {brief(typeof children === "string" ? children : Array.isArray(children) ? children.join("") : children)}
        {onRetry && <button type="button" onClick={onRetry} style={{ display: "block", marginTop: 4, background: "none", border: "none", color: accent, fontWeight: 700, cursor: "pointer", padding: 0, fontSize: 13 }}>Try again</button>}
      </span>
    </div>
  );
}
