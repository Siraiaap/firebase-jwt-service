// service-worker.js (SiraIA)
const CACHE = "siraia-v1";
const CORE_ASSETS = [
  "/",               // si tu hosting sirve index.html en /
  "/index.html",
  "/manifest.webmanifest",
  "/icons/maskable-192.png",
  "/icons/maskable-512.png",
  "/icons/icon-256.png",
  "/icons/icon-384.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k === CACHE ? null : caches.delete(k))))
    )
  );
  self.clients.claim();
});

// Navegación: network-first con fallback a cache (SPA-like)
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Deja pasar llamadas a Stripe, API, etc (no caches CORS/POST)
  if (req.method !== "GET") return;

  // Navegación de páginas
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("/index.html"))
    );
    return;
  }

  // Recursos estáticos: cache-first
  event.respondWith(
    caches.match(req).then((hit) => {
      return (
        hit ||
        fetch(req).then((res) => {
          const resClone = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, resClone));
          return res;
        }).catch(() => hit)
      );
    })
  );
});
