"use client";
import { useEffect, useRef, useState } from "react";

// Makes the installed web app behave like the native app. Everything here is inert in a normal browser tab (only active when LinkedOut
// is launched from the home screen / app list), so the ordinary website is untouched.
//   * (the launch animation was removed: the plain navy cover hides as soon as the app has painted)
//   * pull-to-refresh with a native-style spinner
//   * light haptic tick on tab / nav taps (Android; iPhone does not allow web vibration)
//   * no double-tap zoom, no rubber-band, no long-press callouts on controls (see globals.css)
const standalone = () => { try { return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true; } catch { return false; } };
const scrollable = (el) => { for (let n = el; n && n !== document.body; n = n.parentElement) { const o = getComputedStyle(n).overflowY; if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight && n.scrollTop > 0) return true; } return false; };

export default function NativeFeel() {
  const [pull, setPull] = useState(0), [spin, setSpin] = useState(false);
  const st = useRef({ y: null, d: 0 });

  // ---- launch: no animation. Hide the plain navy boot cover on the first paint. ----
  useEffect(() => {
    const inApp = standalone(), boot = document.getElementById("lo-boot");
    document.documentElement.classList.toggle("lo-standalone", inApp);
    requestAnimationFrame(() => requestAnimationFrame(() => { if (boot) boot.style.display = "none"; }));
  }, []);

  // ---- pull to refresh + haptics (installed app only) ----
  useEffect(() => {
    if (!standalone()) return;
    const down = (e) => { const t = e.target; if (window.scrollY > 0 || e.touches.length !== 1 || t.closest?.("textarea,input,[data-no-ptr],[role=dialog]") || scrollable(t)) { st.current.y = null; return; } st.current = { y: e.touches[0].clientY, d: 0 }; };
    const move = (e) => { const s = st.current; if (s.y == null) return; const dy = e.touches[0].clientY - s.y; if (dy > 0 && window.scrollY <= 0) { s.d = Math.min(110, dy * 0.5); setPull(s.d); } else if (dy < -4) { s.y = null; setPull(0); } };
    const up = () => { const s = st.current; if (s.y == null) { setPull(0); return; } const go = s.d >= 64; st.current = { y: null, d: 0 };
      if (go) { setSpin(true); setPull(56); navigator.vibrate?.(10); setTimeout(() => location.reload(), 350); } else setPull(0); };
    const tap = (e) => { if (e.target.closest?.("nav a, nav button, [role=tab]")) navigator.vibrate?.(6); };
    document.addEventListener("touchstart", down, { passive: true }); document.addEventListener("touchmove", move, { passive: true });
    document.addEventListener("touchend", up, { passive: true }); document.addEventListener("click", tap, true);
    return () => { document.removeEventListener("touchstart", down); document.removeEventListener("touchmove", move); document.removeEventListener("touchend", up); document.removeEventListener("click", tap, true); };
  }, []);

  return (
    <>
      {(pull > 0 || spin) && (
        <div aria-hidden style={{ position: "fixed", left: 0, right: 0, top: "env(safe-area-inset-top, 0px)", zIndex: 90, display: "flex", justifyContent: "center", pointerEvents: "none", transform: `translateY(${pull - 40}px)`, opacity: Math.min(1, pull / 50), transition: st.current.y == null ? "transform 200ms ease, opacity 200ms ease" : "none" }}>
          <div style={{ width: 34, height: 34, borderRadius: 17, background: "var(--lo-surface, #151a24)", border: "1px solid var(--lo-line, #2a3140)", boxShadow: "0 4px 14px rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 16, height: 16, borderRadius: 8, border: "2px solid #4C61FF", borderTopColor: "transparent", transform: spin ? undefined : `rotate(${pull * 4}deg)`, animation: spin ? "lo-spin .7s linear infinite" : "none" }} />
          </div>
        </div>
      )}
    </>
  );
}