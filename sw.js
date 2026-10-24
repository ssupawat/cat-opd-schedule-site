const CACHE = "cat-opd-shell-v4";
const PRECACHE = [
  "./",
  "./index.html",
  "./config.json",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "https://fonts.googleapis.com/css2?family=Anuphan:wght@400;500;600;700&display=swap"
];
const MANAGED = ["cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c =>
    Promise.allSettled(PRECACHE.map(u => c.add(u)))
  ).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (!(url.origin === location.origin || MANAGED.includes(url.hostname))) return;
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).then(r => {
      caches.open(CACHE).then(c => c.put(e.request, r.clone()));
      return r;
    }).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(e.request);
    const fresh = fetch(e.request).then(r => {
      if (r.ok) c.put(e.request, r.clone());
      return r;
    }).catch(() => null);
    return hit || await fresh;
  })());
});
