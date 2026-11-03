"use client";
import { useEffect, useState } from "react";
import { C } from "@/lib/theme";
import { lockSupported, lockEnabled, enableLock, disableLock, GRACES, getGrace, setGrace } from "@/lib/appLock";

// Two settings cards for the installed web app, matching what the native app offers: Notifications on this device, and App Lock.
// Rendered from app/settings/page.js.
const box = { display: "flex", flexDirection: "column", gap: 14 };
const note = { fontSize: 13, color: C.muted, lineHeight: 1.55, margin: 0 };
const btn = (primary) => ({ padding: "10px 16px", borderRadius: 10, border: `1px solid ${primary ? C.mustard : C.line}`, background: primary ? C.mustard : "transparent", color: primary ? "#fff" : C.text, fontWeight: 650, fontSize: 14, cursor: "pointer" });
const Card = ({ title, children }) => <section className="lo-card p-5 md:p-6" style={box}><div style={{ fontSize: 16, fontWeight: 650, color: C.text }}>{title}</div>{children}</section>;
const b64uToBytes = (s) => { const p = (s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"); return Uint8Array.from(atob(p), (c) => c.charCodeAt(0)); };
const standalone = () => { try { return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; } catch { return false; } };
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function WebPushCard() {
  const [st, setSt] = useState("loading"), [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  async function refresh() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) { setSt(isIOS() && !standalone() ? "ios-install" : "unsupported"); return; }
    if (isIOS() && !standalone()) { setSt("ios-install"); return; }
    if (Notification.permission === "denied") { setSt("denied"); return; }
    try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); setSt(sub && Notification.permission === "granted" ? "on" : "off"); } catch { setSt("off"); }
  }
  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function turnOn() {
    setBusy(true); setMsg("");
    try {
      const cfg = await (await fetch("/api/push/web", { cache: "no-store" })).json(); if (!cfg.configured) throw new Error("Notifications are not available right now.");
      const perm = await Notification.requestPermission(); if (perm !== "granted") { setSt(perm === "denied" ? "denied" : "off"); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(cfg.publicKey) }));
      const r = await fetch("/api/push/web", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON() }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Could not turn notifications on.");
      setSt("on"); setMsg("Notifications are on for this device.");
    } catch (e) { setMsg(e.message || "Could not turn notifications on."); } finally { setBusy(false); }
  }
  async function turnOff() {
    setBusy(true); setMsg("");
    try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub) { await fetch("/api/push/web", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) }); await sub.unsubscribe(); } setSt("off"); setMsg("Notifications are off for this device."); }
    catch { setMsg("Could not turn notifications off."); } finally { setBusy(false); }
  }
  async function test() { setBusy(true); const r = await fetch("/api/push/web", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ test: true }) }).catch(() => null); setMsg(r?.ok ? "Test sent. It should arrive in a moment." : "Could not send a test. Try turning notifications off and on again."); setBusy(false); }
  if (st === "loading") return null;
  return (
    <Card title="Notifications on this device">
      {st === "unsupported" && <p style={note}>This browser can’t show notifications from a website. Install LinkedOut as a web app from a current version of Chrome, Edge, Firefox, Samsung Internet or Safari.</p>}
      {st === "ios-install" && <p style={note}>On iPhone and iPad, notifications work once LinkedOut is on your Home Screen: open this site in Safari, tap Share, then Add to Home Screen, and open it from there.</p>}
      {st === "denied" && <p style={note}>Notifications are blocked for LinkedOut on this device. Turn them on in your device or browser settings for this site, then come back here.</p>}
      {st === "off" && <><p style={note}>Get alerts for replies, reactions, messages and everything else you choose under “Notifications” below, even when LinkedOut is closed.</p><div><button style={btn(true)} onClick={turnOn} disabled={busy}>{busy ? "Working…" : "Turn on notifications"}</button></div></>}
      {st === "on" && <><p style={note}>On for this device. Choose what reaches you in the Push column below.</p><div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}><button style={btn(false)} onClick={test} disabled={busy}>Send a test</button><button style={btn(false)} onClick={turnOff} disabled={busy}>Turn off</button></div></>}
      {msg && <p style={{ ...note, color: C.text }}>{msg}</p>}
    </Card>
  );
}

export function AppLockCard() {
  const [on, setOn] = useState(false), [ok, setOk] = useState(null), [busy, setBusy] = useState(false), [msg, setMsg] = useState(""), [grace, setG] = useState(0);
  useEffect(() => { lockSupported().then(setOk); setOn(lockEnabled()); setG(getGrace()); }, []);
  if (ok === null) return null;
  async function turnOn() { setBusy(true); setMsg(""); try { await enableLock(); setOn(true); setMsg("App Lock is on. LinkedOut will ask for your face, fingerprint or device passcode when you open it."); } catch (e) { setMsg(e.message); } finally { setBusy(false); } }
  async function turnOff() { setBusy(true); setMsg(""); try { await disableLock(); setOn(false); setMsg("App Lock is off."); } catch (e) { setMsg(e.message); } finally { setBusy(false); } }
  return (
    <Card title="App Lock">
      {!ok ? <p style={note}>This device or browser doesn’t offer Face ID, fingerprint or passcode unlock to web apps, so App Lock isn’t available here.</p> : (
        <>
          <p style={note}>Ask for Face ID, fingerprint or your device passcode before LinkedOut opens on this device. This protects the app if someone else picks up your phone; it doesn’t replace your password.</p>
          {on && <label style={{ ...note, color: C.text }}>Lock after being away for{" "}<select value={grace} onChange={(e) => { setG(+e.target.value); setGrace(+e.target.value); }} style={{ background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 8px", marginLeft: 6 }}>{GRACES.map(([s, l]) => <option key={s} value={s}>{l}</option>)}</select></label>}
          <div>{on ? <button style={btn(false)} onClick={turnOff} disabled={busy}>Turn off App Lock</button> : <button style={btn(true)} onClick={turnOn} disabled={busy}>{busy ? "Working…" : "Turn on App Lock"}</button>}</div>
        </>
      )}
      {msg && <p style={{ ...note, color: C.text }}>{msg}</p>}
    </Card>
  );
}