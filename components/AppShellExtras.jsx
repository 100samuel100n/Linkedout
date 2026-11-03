"use client";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/app/auth-provider";
import { useNotifications } from "@/app/notifications-provider";
import { lockEnabled, getGrace, verifyLock } from "@/lib/appLock";

// Mounted once inside the providers (app/layout.js). Four quiet jobs that make the web app behave like the native one:
//  1. App Lock screen (if the person turned it on)
//  2. Home-screen badge with the unread count (navigator.setAppBadge)
//  3. Keeps this device's push subscription attached to whoever is signed in; detaches it on sign-out (shared-device safety)
//  4. Reloads once when a new version of the app has been installed in the background
const b64uToBytes = (s) => { const p = (s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"); return Uint8Array.from(atob(p), (c) => c.charCodeAt(0)); };

export default function AppShellExtras() {
  const { user } = useAuth(), notif = useNotifications();
  const [locked, setLocked] = useState(false), [busy, setBusy] = useState(false), hiddenAt = useRef(0), prevUser = useRef(null), lastSub = useRef(null);

  // 1. App Lock
  useEffect(() => {
    if (lockEnabled() && !sessionStorage.getItem("lo-unlocked")) setLocked(true);
    const vis = () => {
      if (document.visibilityState === "hidden") { hiddenAt.current = Date.now(); return; }
      if (lockEnabled() && hiddenAt.current && (Date.now() - hiddenAt.current) / 1000 >= getGrace()) setLocked(true);
    };
    document.addEventListener("visibilitychange", vis); return () => document.removeEventListener("visibilitychange", vis);
  }, []);
  async function unlock() { setBusy(true); const ok = await verifyLock(); setBusy(false); if (ok) { sessionStorage.setItem("lo-unlocked", "1"); setLocked(false); } }
  useEffect(() => { if (locked) { const t = setTimeout(unlock, 250); return () => clearTimeout(t); } }, [locked]); // eslint-disable-line react-hooks/exhaustive-deps

  // 2. badge
  const unread = (notif?.unreadCount || 0) + (notif?.messageUnread || 0);
  useEffect(() => { try { if (!user) navigator.clearAppBadge?.(); else if (unread > 0) navigator.setAppBadge?.(unread); else navigator.clearAppBadge?.(); } catch { /* unsupported */ } }, [unread, user]);

  // 3. push subscription follows the signed-in account
  useEffect(() => {
    const was = prevUser.current; prevUser.current = user?.id || null;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    (async () => {
      const reg = await navigator.serviceWorker.ready.catch(() => null); if (!reg) return; const sub = await reg.pushManager.getSubscription();
      if (user && sub && Notification.permission === "granted") {
        const key = user.id + sub.endpoint; if (lastSub.current === key) return; lastSub.current = key;
        fetch("/api/push/web", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON() }) }).catch(() => {});
      } else if (!user && was && sub) {           // just signed out: stop this device receiving that account's notifications
        lastSub.current = null; fetch("/api/push/web", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) }).catch(() => {});
      }
    })();
  }, [user]);

  // 4. new version installed in the background -> reload once
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return; const had = !!navigator.serviceWorker.controller; let done = false;
    const onChange = () => { if (had && !done) { done = true; location.reload(); } };
    navigator.serviceWorker.addEventListener("controllerchange", onChange);
    const check = () => navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => {});
    const vis = () => document.visibilityState === "visible" && check(); document.addEventListener("visibilitychange", vis);
    return () => { navigator.serviceWorker.removeEventListener("controllerchange", onChange); document.removeEventListener("visibilitychange", vis); };
  }, []);

  if (!locked) return null;
  return (
    <div role="dialog" aria-label="LinkedOut is locked" style={{ position: "fixed", inset: 0, zIndex: 99990, background: "#0C1423", color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, padding: 24, textAlign: "center" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon.png" alt="" width={84} height={84} style={{ borderRadius: 20 }} />
      <div style={{ fontSize: 20, fontWeight: 700 }}>LinkedOut is locked</div>
      <div style={{ opacity: 0.7, fontSize: 14, maxWidth: 280, lineHeight: 1.5 }}>Use your face, fingerprint or device passcode to continue.</div>
      <button onClick={unlock} disabled={busy} style={{ padding: "12px 28px", borderRadius: 12, border: "1px solid #4C61FF", background: "#4C61FF", color: "#fff", fontWeight: 700, fontSize: 16 }}>{busy ? "Checking…" : "Unlock"}</button>
    </div>
  );
}