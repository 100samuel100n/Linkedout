"use client";
import { useEffect, useState } from "react";
// Runtime switches the admin controls (currently: Jobs). One shared request, refreshed every 60 s while the tab is open.
let state = { jobsEnabled: true }, at = 0, inflight = null; const subs = new Set();
function load() {
  if (inflight || Date.now() - at < 60000) return;
  inflight = fetch("/api/feed-config", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) { state = { jobsEnabled: d.jobsEnabled !== false }; subs.forEach((f) => f(state)); } at = Date.now(); }).catch(() => { at = Date.now() - 45000; }).finally(() => { inflight = null; });
}
export function useRemoteFlags() {
  const [s, set] = useState(state);
  useEffect(() => { subs.add(set); load(); const t = setInterval(load, 60000); return () => { subs.delete(set); clearInterval(t); }; }, []);
  return s;
}
