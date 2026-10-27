"use client";
import { useEffect } from "react";
import { useAuth } from "@/app/auth-provider";

// Tells the server "this person is here" every 30 seconds while the tab is visible, so staff can see
// who is online in the admin dashboard. Silent, tiny, and stops when the tab is hidden or closed.
export default function PresenceBeacon() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user) return;
    let timer = null;
    const ping = (state) => fetch("/api/presence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform: "web", state }), keepalive: true }).catch(() => {});
    const start = () => { if (timer) return; ping(); timer = setInterval(() => ping(), 30000); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const onVis = () => (document.visibilityState === "visible" ? start() : stop());
    const onHide = () => { stop(); try { navigator.sendBeacon?.("/api/presence", new Blob([JSON.stringify({ platform: "web", state: "offline" })], { type: "application/json" })); } catch {} };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    return () => { stop(); document.removeEventListener("visibilitychange", onVis); window.removeEventListener("pagehide", onHide); };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
