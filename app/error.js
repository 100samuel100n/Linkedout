"use client";
import { useEffect } from "react";
import { C, displayFont, monoFont } from "@/lib/theme";

// Shown if a page crashes while rendering. No stack, no file paths — a calm
// message and a way forward. Details go to the console for developers only.
export default function Error({ error, reset }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div style={{ maxWidth: 420, margin: "80px auto", padding: 20, textAlign: "center" }}>
      <div style={{ ...displayFont, fontSize: 22, color: C.text, marginBottom: 8 }}>Something went wrong</div>
      <div style={{ ...monoFont, fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 20 }}>We hit a snag loading this page. Your data is safe — give it another try.</div>
      <button onClick={reset} style={{ ...monoFont, fontSize: 13, fontWeight: 700, color: "#fff", background: C.mustard, border: "none", borderRadius: 10, padding: "10px 24px", cursor: "pointer" }}>Try again</button>
    </div>
  );
}
