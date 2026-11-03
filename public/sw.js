/* LinkedOut service worker: makes the home-screen app feel native (instant shell, offline notice) without ever caching private data.
   - /api/*, anything with an Authorization/cookie-dependent response, and non-GET requests are NEVER cached.
   - Static build assets and icons: cache-first (they are content-hashed).
   - Page navigations: network-first; if offline, show /offline.html. */
const V = "lo-shell-v1", SHELL = ["/offline.html", "/icon.png", "/apple-icon.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/") || u.pathname.startsWith("/admin")) return;
  if (u.pathname.startsWith("/_next/static/") || u.pathname === "/icon.png" || u.pathname === "/apple-icon.png") {
    e.respondWith(caches.open(V).then(async (c) => { const hit = await c.match(r); if (hit) return hit; const res = await fetch(r); if (res.ok) c.put(r, res.clone()); return res; }));
    return;
  }
  if (r.mode === "navigate") e.respondWith(fetch(r).catch(() => caches.match("/offline.html")));
});

/* ---- Web Push (notifications for the installed web app) ---- */
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { title: "LinkedOut", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "LinkedOut", { body: d.body || "", icon: "/icon.png", badge: "/icon.png", tag: d.tag || "lo", renotify: true, silent: !!d.silent, data: { url: d.url || "/notifications" } }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close(); const url = new URL(e.notification.data?.url || "/notifications", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => { for (const c of cs) if ("focus" in c) { c.navigate?.(url); return c.focus(); } return self.clients.openWindow(url); }));
});