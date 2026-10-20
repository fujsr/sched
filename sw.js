// Service worker: offline support + installability for the Staff Schedule app
const VERSION = "staff-schedule-v3.1.0";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./logo.png",
  "./logo-white.png",
  "./icon-192.png",
  "./icon-512.png",
  "./maskable-512.png",
  "./apple-touch-icon.png",
  "./favicon-32.png",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.28/jspdf.plugin.autotable.min.js"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // Cache each file on its own: one missing or blocked file must never stop the
    // worker from installing (a failed worker means the browser won't offer "Install").
    await Promise.all(APP_SHELL.map(u => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET" || !req.url.startsWith("http")) return;

  // Pages: network first (always fresh when online), cached copy when offline
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put("./index.html", copy)); }
        return res;
      } catch (e) {
        return (await caches.match("./index.html")) || (await caches.match("./")) ||
          new Response("<h1>Offline</h1><p>Open the app once while online.</p>", { headers: { "Content-Type": "text/html" } });
      }
    })());
    return;
  }

  // Assets, fonts, PDF library: cache first, refresh in background
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req).then(res => {
      if (res && (res.ok || res.type === "opaque")) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => cached || Response.error());
    return cached || network;
  })());
});
