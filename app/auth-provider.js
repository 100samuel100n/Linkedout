"use client";
import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadedOnce = useRef(false);
  const lastJson = useRef("null");

  // Only the very first load shows a loading state; every later refresh (after saving
  // something, or the background sync below) updates the account quietly in place.
  const refresh = useCallback(async () => {
    if (!loadedOnce.current) setLoading(true);
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data = await res.json();
      const json = JSON.stringify(data.user ?? null);
      if (json !== lastJson.current) { lastJson.current = json; setUser(data.user ?? null); }
      return data.user;
    } catch {
      return null; // a missed sync is harmless; keep what we have
    } finally {
      loadedOnce.current = true;
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Cross-device sync: the web app and the mobile app share one account on the server. Pull
  // the latest whenever this tab regains focus and every 30s while it's visible, so a change
  // made on the other device (profile, photo, plan, security, preferences) appears here by
  // itself.
  useEffect(() => {
    const tick = () => { if (!document.hidden) refresh(); };
    const id = setInterval(tick, 30000);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); window.removeEventListener("focus", tick); };
  }, [refresh]);

  async function logout() {
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
    lastJson.current = "null";
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
