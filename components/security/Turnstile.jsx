"use client";
import { useEffect, useRef } from "react";
// Cloudflare Turnstile widget. Rendered only when the server asks for a challenge (adaptive), so most people never see it.
export default function Turnstile({ siteKey, onToken }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!siteKey) return undefined;
    let id, dead = false;
    const mount = () => { if (!dead && window.turnstile && ref.current) id = window.turnstile.render(ref.current, { sitekey: siteKey, theme: "dark", callback: onToken, "expired-callback": () => onToken("") }); };
    if (window.turnstile) mount();
    else { const s = document.createElement("script"); s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; s.async = true; s.onload = mount; document.head.appendChild(s); }
    return () => { dead = true; try { window.turnstile?.remove(id); } catch {} };
  }, [siteKey, onToken]);
  return <div ref={ref} style={{ minHeight: 65 }} />;
}
