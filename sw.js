const VERSION = "staff-schedule-v3.0";
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
    // worker from installing. cache: "reload" skips the browser's HTTP cache so a
    // new version never gets filled with stale copies.
    await Promise.all(APP_SHELL.map(async u => {
      try {
        const isCrossOrigin = !u.startsWith("./");
        const req = new Request(u, isCrossOrigin ? { mode: "no-cors", cache: "reload" } : { cache: "reload" });
        const res = await fetch(req);
        if (res.ok || res.type === "opaque") await cache.put(u, res);
      } catch (e) { /* ignore single-file failures */ }
    }));
    // Activate immediately instead of waiting for every tab to close
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (e) {}
    }
    await self.clients.claim();
    // Tell every open window a new version is live so it can reload itself
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    wins.forEach(c => c.postMessage({ type: "SW_UPDATED", version: VERSION }));
  })());
});

// Page can ask the worker for its version, or force activation of a waiting worker
self.addEventListener("message", event => {
  const msg = event.data || {};
  if (msg.type === "SKIP_WAITING") self.skipWaiting();
  if (msg.type === "GET_VERSION" && event.source) event.source.postMessage({ type: "VERSION", version: VERSION });
});

const putInCache = (key, res) => {
  if (res && (res.ok || res.type === "opaque")) {
    const copy = res.clone();
    caches.open(VERSION).then(c => c.put(key, copy)).catch(() => {});
  }
  return res;
};

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET" || !req.url.startsWith("http")) return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Never let the worker cache itself
  if (sameOrigin && url.pathname.endsWith("/sw.js")) return;

  // Pages: network first, bypassing the HTTP cache, cached copy when offline
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const preload = await event.preloadResponse;
        const res = preload || await fetch(req, { cache: "no-cache" });
        if (res.ok) putInCache("./index.html", res);
        return res;
      } catch (e) {
        return (await caches.match("./index.html")) || (await caches.match("./")) ||
          new Response("<h1>Offline</h1><p>Open the app once while online.</p>", { headers: { "Content-Type": "text/html" } });
      }
    })());
    return;
  }

  // Own files (manifest, images, scripts): network first so updates show up right away
  if (sameOrigin) {
    event.respondWith(
      fetch(req, { cache: "no-cache" })
        .then(res => putInCache(req, res))
        .catch(async () => (await caches.match(req)) || Response.error())
    );
    return;
  }

  // CDN files (versioned URLs, never change): cache first, refresh in background
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req).then(res => putInCache(req, res)).catch(() => cached || Response.error());
    return cached || network;
  })());
});
