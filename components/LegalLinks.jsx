"use client";
import Link from "next/link";
import { C, monoFont } from "@/lib/theme";

// Small, always-available legal footer links (login, signup, settings, side panel).
export default function LegalLinks({ style }) {
  const a = { color: C.muted, textDecoration: "underline", textUnderlineOffset: 2 };
  return (
    <div style={{ ...monoFont, fontSize: 12, color: C.muted, display: "flex", gap: 12, flexWrap: "wrap", ...style }}>
      <Link href="/terms" style={a}>Terms</Link>
      <Link href="/privacy" style={a}>Privacy</Link>
      <Link href="/legal/dmca" style={a}>Copyright</Link>
    </div>
  );
}
