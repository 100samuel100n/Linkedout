"use client";
import { useEffect } from "react";

// Keyboard handling by input TYPE (not one scrollIntoView for everything):
//  1. DOCKED / STICKY inputs (chat boxes, composer bars pinned to the bottom): the bar rides on top of the keyboard.
//     Fixed/sticky bars are translated by the keyboard height with the keyboard's own easing; in-flow docked bars
//     (data-kb="chat" or sitting at the bottom of the page) are scrolled so their bottom edge lands right above it.
//  2. STANDARD FORM INPUTS (long forms): the focused field is brought into the upper third of the *visible* area
//     (visual viewport), with dynamic scroll padding so the last fields can still be lifted above the keyboard.
//  3. EXPANDING TEXTAREAS: capped with a max-height (~38% of the visible area) and scrolled internally, so the box
//     never grows down into the keyboard and the caret line stays visible.
// Published CSS variables: --lo-kb (keyboard height), --lo-vvh (visible height). Works with the Android
// `interactive-widget=resizes-content` viewport (kb reads 0 there because the layout itself shrinks) and iOS
// (layout viewport stays tall, VisualViewport shrinks). Respects prefers-reduced-motion.
const FIELD = /^(INPUT|TEXTAREA|SELECT)$/;
const NO_KB = new Set(["checkbox", "radio", "button", "submit", "file", "range", "color", "image", "reset"]);
const CUSHION = 20;

const isField = (el) => el instanceof HTMLElement && ((FIELD.test(el.tagName) && !NO_KB.has(el.type)) || el.isContentEditable);
function scrollParent(el) {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return document.scrollingElement || document.documentElement;
}
function dockedAncestor(el) {
  for (let p = el; p && p !== document.body; p = p.parentElement) {
    if (p.dataset?.kb === "chat") return { el: p, fixed: false };
    const cs = getComputedStyle(p);
    if ((cs.position === "fixed" || cs.position === "sticky") && p.getBoundingClientRect().bottom >= window.innerHeight - 4) return { el: p, fixed: true };
  }
  return null;
}

export default function KeyboardInsets() {
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const smooth = reduce ? "auto" : "smooth";
    let kb = 0, active = null, lifted = null, capped = null, raf = 0, timer = 0;

    const measure = () => {
      const h = vv ? vv.height : window.innerHeight;
      const covered = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
      kb = covered > 80 ? covered : 0;
      root.style.setProperty("--lo-kb", `${kb}px`);
      root.style.setProperty("--lo-vvh", `${Math.round(h)}px`);
      // Dynamic scroll padding: lets the last fields scroll high enough to clear the keyboard.
      root.style.scrollPaddingBottom = kb ? `${kb + CUSHION}px` : "";
    };

    const lift = (el) => { // 1a. fixed/sticky bar rides on the keyboard
      if (lifted && lifted !== el) unlift();
      if (!el) return;
      lifted = el;
      el.style.willChange = "transform";
      el.style.transition = reduce ? "none" : "transform .24s cubic-bezier(.2,.8,.2,1)";
      el.style.transform = kb ? `translateY(${-kb}px)` : "";
    };
    const unlift = () => { if (lifted) { lifted.style.transform = ""; const l = lifted; setTimeout(() => { l.style.transition = ""; l.style.willChange = ""; }, 300); lifted = null; } };

    const cap = (ta) => { // 3. expanding textarea: max-height + internal scroll
      if (!kb) return uncap();
      const visible = vv ? vv.height : window.innerHeight;
      if (capped && capped.el !== ta) uncap();
      if (!capped) capped = { el: ta, maxHeight: ta.style.maxHeight, overflowY: ta.style.overflowY };
      ta.style.maxHeight = `${Math.max(88, Math.round(visible * 0.38))}px`;
      ta.style.overflowY = "auto";
    };
    const uncap = () => { if (capped) { capped.el.style.maxHeight = capped.maxHeight; capped.el.style.overflowY = capped.overflowY; capped = null; } };
    const keepCaretVisible = (ta) => {
      if (ta.selectionEnd === ta.value.length && ta.scrollHeight > ta.clientHeight) ta.scrollTop = ta.scrollHeight;
      place(ta, "expanding");
    };

    const place = (el, mode) => {
      if (!el || !document.contains(el)) return;
      const top = vv ? vv.offsetTop : 0, h = vv ? vv.height : window.innerHeight;
      const r = el.getBoundingClientRect();
      const bottomLimit = top + h - CUSHION;
      let delta = 0;
      if (mode === "docked") delta = r.bottom - (top + h - 6);                  // bottom edge flush above the keyboard
      else if (mode === "expanding") delta = r.bottom > bottomLimit ? r.bottom - bottomLimit : (r.top < top + 8 ? r.top - top - 8 : 0);
      else { // form: upper third, unless already comfortably in the upper-middle band
        const want = top + h * 0.3, inBand = r.top >= top + h * 0.12 && r.top <= top + h * 0.5 && r.bottom <= bottomLimit;
        delta = inBand ? 0 : r.top - want;
        if (r.height > h * 0.45) delta = Math.min(delta, Math.max(0, r.bottom - bottomLimit)) || delta;
      }
      if (Math.abs(delta) < 2) return;
      const sp = scrollParent(el);
      (sp === document.scrollingElement || sp === document.documentElement ? window : sp).scrollBy({ top: delta, behavior: smooth });
    };

    const handle = (el) => {
      if (!isField(el)) return;
      active = el;
      const dock = dockedAncestor(el);
      if (dock?.fixed) { lift(dock.el); place(el, "docked"); }
      else if (dock) { place(dock.el, "docked"); }
      else {
        if (lifted) unlift();
        if (el.tagName === "TEXTAREA") { cap(el); place(el, "expanding"); }
        else place(el, "form");
      }
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { if (active && document.activeElement === active) handle(active); }, 120); };

    const onViewport = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        measure();
        if (lifted) lifted.style.transform = kb ? `translateY(${-kb}px)` : "";
        if (!kb) { uncap(); if (!active || document.activeElement !== active) unlift(); }
        else schedule();
      });
    };
    const onFocusIn = (e) => { if (!isField(e.target)) return; active = e.target; measure(); setTimeout(() => handle(e.target), 60); setTimeout(() => handle(e.target), 320); };
    const onFocusOut = () => { setTimeout(() => { if (!isField(document.activeElement)) { active = null; uncap(); unlift(); } }, 80); };
    const onInput = (e) => { if (e.target?.tagName === "TEXTAREA" && kb) { cap(e.target); keepCaretVisible(e.target); } };

    vv?.addEventListener("resize", onViewport); vv?.addEventListener("scroll", onViewport);
    document.addEventListener("focusin", onFocusIn); document.addEventListener("focusout", onFocusOut); document.addEventListener("input", onInput, true);
    window.addEventListener("orientationchange", onViewport);
    measure();
    return () => {
      vv?.removeEventListener("resize", onViewport); vv?.removeEventListener("scroll", onViewport);
      document.removeEventListener("focusin", onFocusIn); document.removeEventListener("focusout", onFocusOut); document.removeEventListener("input", onInput, true);
      window.removeEventListener("orientationchange", onViewport);
      clearTimeout(timer); cancelAnimationFrame(raf); uncap(); unlift();
    };
  }, []);
  return null;
}
