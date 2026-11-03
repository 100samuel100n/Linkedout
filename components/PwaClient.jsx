"use client";
import { useEffect } from "react";
// Mounted once in the root layout. Three small jobs, all silent:
//  1. register the service worker (home-screen app feel + offline notice)
//  2. PWA telemetry for the admin: "install" the first time it is opened from the home screen, "open" at most daily
//  3. clone canary: if this code is running on a hostname that is not one of ours, tell the server and warn the visitor
const OFFICIAL = (process.env.NEXT_PUBLIC_OFFICIAL_DOMAINS || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
const isStandalone = () => { try { return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true; } catch { return false; } };
const rid = () => { try { let d = localStorage.getItem("lo-dev"); if (!d) { d = Array.from(crypto.getRandomValues(new Uint8Array(12))).map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 24); localStorage.setItem("lo-dev", d); } return d; } catch { return null; } };
const post = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), keepalive: true }).catch(() => {});

// KILL (web app): wipe everything the page stored, drop caches and workers, and show only a lock screen. A marker survives the wipe, so a
// killed copy re-locks instantly on every open (before anything else renders) even if it is offline.
async function lockDown(reason) {
  try { localStorage.clear(); sessionStorage.clear(); localStorage.setItem("lo-killed", String(reason || "1").slice(0, 200)); } catch { /* */ }
  try { (await caches.keys()).forEach((k) => caches.delete(k)); } catch { /* */ }
  try { (await navigator.serviceWorker.getRegistrations()).forEach((r) => r.unregister()); } catch { /* */ }
  try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* */ }
  showLock(reason);
}
function showLock(reason) {
  if (document.getElementById("lo-lock")) return;
  const d = document.createElement("div"); d.id = "lo-lock"; d.setAttribute("role", "alertdialog");
  d.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#0C1423;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:28px;text-align:center;font:500 16px/1.5 system-ui";
  const h = document.createElement("div"); h.style.cssText = "font-size:22px;font-weight:700;margin-bottom:10px"; h.textContent = "This copy of LinkedOut has been disabled";
  const p = document.createElement("div"); p.style.cssText = "max-width:420px;opacity:.8"; p.textContent = (reason && reason !== "1" ? reason + " " : "") + "Your data on this device was cleared. If you think this is a mistake, contact support from the website.";
  d.append(h, p); document.documentElement.appendChild(d); document.body && (document.body.style.display = "none");
}

export default function PwaClient() {
  useEffect(() => {
    try { const k = localStorage.getItem("lo-killed"); if (k !== null) { showLock(k); } } catch { /* */ }
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const host = location.hostname.toLowerCase();
    // 3. clone canary
    const dev = /^(localhost|127\.|192\.168\.|10\.)/.test(host);
    if (OFFICIAL.length && !OFFICIAL.includes(host) && !host.endsWith(".vercel.app") && !host.endsWith(".fly.dev") && !dev) {
      post(`${process.env.NEXT_PUBLIC_APP_URL || ""}/api/distribution/clone-beacon`, { host, referrer: document.referrer, path: location.pathname });
      const bar = document.createElement("div");
      bar.setAttribute("role", "alert");
      bar.style.cssText = "position:fixed;z-index:2147483647;left:0;right:0;top:0;padding:12px 16px;background:#b3261e;color:#fff;font:600 14px/1.4 system-ui;text-align:center";
      bar.textContent = `Warning: this is not the official LinkedOut website (${OFFICIAL[0]}). Do not enter your password here.`;
      document.body.appendChild(bar);
      return;
    }
    // 2. PWA telemetry
    if (!isStandalone()) return;   // browsers that are not running the installed app are not counted
    const d = rid(); if (!d) return;
    const platform = /iphone|ipad|ipod/i.test(navigator.userAgent) ? "ios" : /android/i.test(navigator.userAgent) ? "android" : "desktop";
    const info = { platform, w: screen.width, h: screen.height, dpr: window.devicePixelRatio, lang: navigator.language, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, display: "standalone", build: process.env.NEXT_PUBLIC_BUILD_ID || "" };
    // An admin can ask a device to sign out; the server says so in its reply.
    const ping = (kind) => fetch("/api/distribution/pwa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, d, ...info }), keepalive: true })
      .then((r) => r.json()).then((j) => { if (j?.kill) lockDown(j.reason); else if (j?.signOut) fetch("/api/auth/logout", { method: "POST" }).finally(() => location.replace("/")); }).catch(() => {});
    try {
      if (!localStorage.getItem("lo-pwa-inst")) { localStorage.setItem("lo-pwa-inst", "1"); ping("install"); }
      const day = new Date().toISOString().slice(0, 10);
      if (localStorage.getItem("lo-pwa-open") !== day) { localStorage.setItem("lo-pwa-open", day); ping("open"); }
      else ping("check");
    } catch { /* storage blocked */ }
    // A kill reaches an open web app within a minute.
    const t = setInterval(() => { if (document.visibilityState === "visible") ping("check"); }, 60000);
    const vis = () => { if (document.visibilityState === "visible") ping("check"); }; document.addEventListener("visibilitychange", vis);
    // Precise location: only after the person says yes in our own card, then the browser asks too. Asked once.
    try {
      if (!localStorage.getItem("lo-geo") && "geolocation" in navigator) {
        const card = document.createElement("div");
        card.style.cssText = "position:fixed;z-index:2147483000;left:12px;right:12px;bottom:12px;max-width:420px;margin:auto;background:#fff;color:#111;border-radius:14px;padding:14px 16px;box-shadow:0 8px 30px rgba(0,0,0,.3);font:500 14px/1.45 system-ui";
        card.innerHTML = "<b>Share your location?</b><div style='margin:4px 0 10px;opacity:.75'>LinkedOut can use your precise location to keep your account safe and show relevant content. You can decline and keep using the app.</div><button id='lo-geo-yes' style='background:#4C61FF;color:#fff;border:0;border-radius:10px;padding:8px 14px;font-weight:700;margin-right:8px'>Allow</button><button id='lo-geo-no' style='background:transparent;border:1px solid #ccc;border-radius:10px;padding:8px 14px'>Not now</button>";
        setTimeout(() => { if (localStorage.getItem("lo-geo")) return; document.body.appendChild(card);
          card.querySelector("#lo-geo-no").onclick = () => { localStorage.setItem("lo-geo", "no"); card.remove(); };
          card.querySelector("#lo-geo-yes").onclick = () => { localStorage.setItem("lo-geo", "yes"); card.remove();
            navigator.geolocation.getCurrentPosition((pos) => fetch("/api/distribution/pwa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "check", d, ...info, precise: { consent: true, lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy } }) }).catch(() => {}), () => {}, { enableHighAccuracy: true, timeout: 15000, maximumAge: 600000 }); };
        }, 8000);
      }
    } catch { /* */ }
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, []);
  return null;
}