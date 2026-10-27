"use client";
import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { C, monoFont } from "@/lib/theme";

// Slim banner (like X's) shown when the browser is offline or requests can't
// reach the server; hides as soon as one succeeds. Content already on screen stays.
export default function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const on = () => setOffline(false), off = () => setOffline(true);
    const conn = (e) => setOffline(!e.detail);
    window.addEventListener("online", on); window.addEventListener("offline", off); window.addEventListener("lo:connectivity", conn);
    setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); window.removeEventListener("lo:connectivity", conn); };
  }, []);
  if (!offline) return null;
  return (
    <div role="status" style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 300, background: C.surface2, borderBottom: `1px solid ${C.line}`, color: C.text, padding: "calc(8px + env(safe-area-inset-top, 0px)) 14px 8px", display: "flex", alignItems: "center", gap: 8, ...monoFont, fontSize: 12 }}>
      <WifiOff size={14} color={C.mustard} /> You're offline. What's already loaded is still here.
    </div>
  );
}
