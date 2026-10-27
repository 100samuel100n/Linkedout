"use client";
import { useCallback, useEffect, useRef } from "react";
// Lightweight behavioural signals for bot defence: how long the form was open, how many keystrokes, whether the
// pointer/touch was used, whether the content was pasted/autofilled, and whether keystroke timing is machine-regular.
// Nothing about WHAT was typed is recorded, only counts and timing.
export function useBehavior() {
  const s = useRef({ t0: Date.now(), keys: 0, moves: 0, pasted: false, touch: false, autofill: false, gaps: [], last: 0 });
  useEffect(() => {
    const b = s.current; b.t0 = Date.now();
    const key = () => { const n = performance.now(); if (b.last) b.gaps.push(n - b.last); b.last = n; b.keys++; };
    const move = () => { b.moves++; };
    const touch = () => { b.touch = true; };
    const paste = () => { b.pasted = true; };
    window.addEventListener("keydown", key); window.addEventListener("pointermove", move, { passive: true }); window.addEventListener("touchstart", touch, { passive: true }); window.addEventListener("paste", paste);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("pointermove", move); window.removeEventListener("touchstart", touch); window.removeEventListener("paste", paste); };
  }, []);
  return useCallback(() => {
    const b = s.current, g = b.gaps.slice(-30);
    const mean = g.reduce((a, x) => a + x, 0) / (g.length || 1), sd = Math.sqrt(g.reduce((a, x) => a + (x - mean) ** 2, 0) / (g.length || 1));
    return { ms: Date.now() - b.t0, keys: b.keys, moves: b.moves, touch: b.touch, pasted: b.pasted, autofill: b.keys === 0 && b.autofill, uniform: g.length >= 12 && sd < 4 };
  }, []);
}
