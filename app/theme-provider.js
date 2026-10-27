"use client";
import { createContext, useContext, useEffect, useState, useCallback } from "react";

const STORAGE_KEY = "lo-theme-mode"; // 'system' | 'light' | 'dark'
const ThemeContext = createContext(null);

function systemPrefersDark() {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(resolvedMode) {
  document.documentElement.setAttribute("data-theme", resolvedMode);
}

export function ThemeProvider({ children }) {
  // Server-rendered value must match what the pre-hydration inline script
  // (see app/layout.js) sets, or React will warn about a mismatch. Both
  // default to 'dark' before any localStorage/system read happens.
  const [mode, setModeState] = useState("dark");
  const [resolvedMode, setResolvedMode] = useState("dark");

  // Read the real preference once mounted (can't touch localStorage/
  // matchMedia during SSR) and reconcile with whatever the inline script
  // already applied, so there's no visible flash.
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    // Dark by default for everyone; Light and "Match device" apply only if the person chose them.
    const initialMode = stored === "light" || stored === "dark" || stored === "system" ? stored : "dark";
    setModeState(initialMode);
    setResolvedMode(initialMode === "system" ? (systemPrefersDark() ? "dark" : "light") : initialMode);
  }, []);

  // Live-update if mode is 'system' and the OS-level preference changes
  // while the app is open.
  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (e) => setResolvedMode(e.matches ? "dark" : "light");
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, [mode]);

  // Apply to the DOM (and thus every CSS var everywhere) whenever the
  // resolved mode changes.
  useEffect(() => {
    applyTheme(resolvedMode);
  }, [resolvedMode]);

  const setMode = useCallback((next) => {
    setModeState(next);
    localStorage.setItem(STORAGE_KEY, next);
    setResolvedMode(next === "system" ? (systemPrefersDark() ? "dark" : "light") : next);
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, resolvedMode, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
