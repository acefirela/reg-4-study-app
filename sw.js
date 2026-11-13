// Service worker: lets the installed app open without a connection.
// The page itself is fetched fresh when online (so updates show up) and served from the
// saved copy when offline or when the network is slow. Audio guides are saved by the page.
const SHELL = "reg4-shell-v1";
const FILES = ["./", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/icon.svg"];

self.addEventListener("install", e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("reg4-shell-") && k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.includes("/audio/")) return;
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      const cache = await caches.open(SHELL), saved = await cache.match("./");
      const fresh = fetch(req).then(res => { if (res.ok) cache.put("./", res.clone()); return res; });
      if (!saved) return fresh;
      const slow = new Promise(r => setTimeout(() => r(saved), 3000));       // slow network: use the saved copy
      return Promise.race([fresh.catch(() => saved), slow]);
    })());
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok) caches.open(SHELL).then(c => c.put(req, res.clone()));
    return res.clone();
  })));
});
