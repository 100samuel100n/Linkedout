"use client";
import { useEffect, useRef } from "react";
import { C, monoFont } from "@/lib/theme";

// Google AdSense in-feed unit. Everything is controlled from the admin
// dashboard (Feed controls): the master switch, publisher id, slot id and
// frequency. The Google script is only ever loaded when AdSense is switched on
// and configured, so turning it off removes it completely.
let scriptFor = null;
function loadScript(client) {
  if (typeof document === "undefined" || scriptFor === client) return;
  scriptFor = client;
  const s = document.createElement("script");
  s.async = true; s.crossOrigin = "anonymous";
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
  document.head.appendChild(s);
}

export default function AdSenseUnit({ client, slot }) {
  const pushed = useRef(false);
  useEffect(() => {
    if (!client || !slot || pushed.current) return;
    loadScript(client);
    pushed.current = true;
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* blocked by an ad blocker: leave the slot empty */ }
  }, [client, slot]);
  if (!client || !slot) return null;
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: "8px 10px", overflow: "hidden" }}>
      <div style={{ ...monoFont, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: C.muted, marginBottom: 4 }}>Advertisement</div>
      <ins className="adsbygoogle" style={{ display: "block", minHeight: 90 }} data-ad-client={client} data-ad-slot={slot} data-ad-format="auto" data-full-width-responsive="true" />
    </div>
  );
}
