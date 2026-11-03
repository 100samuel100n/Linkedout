"use client";
// Records "this item was actually on screen" for view metrics (stored now, shown later). An item counts after it
// has been at least half visible for a second; each item is sent once per page load, in small batches, and
// failures are silent.
import { useEffect, useRef } from "react";

const sent = new Set();
let queue = [], timer = null;
function flush() {
  timer = null;
  const batch = queue.splice(0, 50);
  if (!batch.length) return;
  fetch("/api/views", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ views: batch }), keepalive: true }).catch(() => {});
  if (queue.length) timer = setTimeout(flush, 3000);
}
function enqueue(kind, id) {
  const k = `${kind}:${id}`; if (!id || sent.has(k)) return; sent.add(k);
  queue.push({ kind, id: String(id) });
  if (queue.length >= 20) { clearTimeout(timer); flush(); } else if (!timer) timer = setTimeout(flush, 5000);
}
if (typeof window !== "undefined") window.addEventListener("pagehide", () => { if (queue.length) flush(); });

// const ref = useImpression("post", post.id); <article ref={ref}>
export function useImpression(kind, id) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current; if (!el || !id || typeof IntersectionObserver === "undefined") return undefined;
    let t = null;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { if (!t) t = setTimeout(() => { enqueue(kind, id); io.disconnect(); }, 1000); }
      else if (t) { clearTimeout(t); t = null; }
    }, { threshold: 0.5 });
    io.observe(el);
    return () => { clearTimeout(t); io.disconnect(); };
  }, [kind, id]);
  return ref;
}
