"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { C, monoFont, displayFont, alpha } from "@/lib/theme";
import { api } from "@/lib/api";

export function Stamp({ text, tone = "flag", rotate = -8 }) {
  const color = tone === "flag" ? C.flag : tone === "green" ? C.green : C.mustard;
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        border: `2px solid ${color}`, color, borderRadius: 3,
        padding: "2px 8px", fontSize: 12, ...displayFont, fontWeight: 800,
        transform: `rotate(${rotate}deg)`, letterSpacing: "0.06em",
        textTransform: "uppercase", background: "rgba(0,0,0,0.15)",
      }}
    >
      {text}
    </span>
  );
}

export function Redacted({ value }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <button
      onClick={() => setRevealed((r) => !r)}
      className="rounded"
      style={{
        ...monoFont, fontSize: 13, padding: "2px 8px", border: "none", cursor: "pointer",
        background: revealed ? "transparent" : "#0B0B0D",
        color: revealed ? C.mustard : "#0B0B0D",
        outline: revealed ? `1px dashed ${C.line}` : "none",
      }}
      title={revealed ? "Tap to hide" : "Tap to reveal"}
    >
      {revealed ? value : "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588"}
    </button>
  );
}

export function MoodPill({ text }) {
  return (
    <span style={{
      ...monoFont, fontSize: 12, color: C.mustard, border: `1px solid ${alpha(C.mustard, 33)}`,
      background: alpha(C.mustard, 8), padding: "1px 8px", borderRadius: 20,
    }}>{text}</span>
  );
}

export function PulseDot({ color = C.flag }) {
  return (
    <span style={{ position: "relative", display: "inline-flex", width: 8, height: 8 }}>
      <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: color, animation: "lo-pulse 1.6s ease-out infinite" }} />
      <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: color }} />
    </span>
  );
}

export function Modal({ open, onClose, title, children, icon: Icon }) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(10,10,12,0.72)", zIndex: 50,
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        animation: "lo-fade-up 0.18s ease both",
      }}
      className="sm:items-center"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, width: "100%",
          maxWidth: 480, maxHeight: "88vh", overflowY: "auto",
          animation: "lo-toast-in 0.24s cubic-bezier(0.2, 0.9, 0.3, 1.1) both",
        }}
        className="p-5 flex flex-col gap-4"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2" style={{ ...displayFont, fontSize: 16, color: C.text }}>
            {Icon && <Icon size={16} color={C.mustard} />} {title}
          </div>
          <button onClick={onClose} className="lo-tap" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", borderRadius: 8 }}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Small confirm/feedback toast — replaces plain-text inline notices with
// a pill that slides in, so actions (bookmarked, link copied, reposted)
// visibly acknowledge themselves instead of just quietly changing state.
export function Toast({ message, tone = "default" }) {
  if (!message) return null;
  const color = tone === "error" ? C.flag : tone === "success" ? C.green : C.mustard;
  return (
    <div
      className="lo-toast"
      style={{
        ...monoFont, fontSize: 12, color: "#FFFFFF", background: color,
        borderRadius: 20, padding: "6px 14px", display: "inline-flex", alignItems: "center",
        boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
      }}
    >
      {message}
    </div>
  );
}
