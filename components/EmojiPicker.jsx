"use client";
import { C } from "@/lib/theme";

// A curated set rather than a full Unicode emoji library — keeps this
// dependency-free and fast. Covers the common reaction/expression range
// people actually reach for in a reply.
const EMOJI = [
  "😀","😂","🤣","😅","😊","😍","🥹","😎","🤔","😐","😑","🙄","😬","😢","😭","😤","😡","🤯","🥳","🤩",
  "👍","👎","👏","🙌","🙏","💪","🤝","✌️","🤞","👀",
  "🔥","💯","✨","🎉","💀","🤡","😈","👻","🚩","⚠️",
  "❤️","🧡","💛","💚","💙","💜","🖤","🤍","💔","😴",
];

export default function EmojiPicker({ onSelect, onClose }) {
  return (
    <div
      style={{
        position: "absolute", bottom: "100%", left: 0, marginBottom: 8, zIndex: 20,
        background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16,
        padding: 10, width: 260, boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
      }}
      className="lo-toast"
    >
      <div className="grid grid-cols-8 gap-1" style={{ maxHeight: 180, overflowY: "auto" }}>
        {EMOJI.map((e) => (
          <button
            key={e}
            onClick={() => { onSelect(e); onClose?.(); }}
            className="lo-tap"
            style={{ fontSize: 18, background: "none", border: "none", borderRadius: 6, padding: 4, cursor: "pointer" }}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
