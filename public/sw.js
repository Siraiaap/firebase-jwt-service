// sw.js - Service Worker básico para SiraIA (chat)
// Cachea el shell principal para que la app cargue rápido.

const CACHE_NAME = 'siraia-chat-v1';
const URLS_TO_CACHE = [
  '/',
  '/index.html'
  // Agrega aquí CSS/JS estáticos si quieres cachearlos explícitamente.
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(URLS_TO_CACHE))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;

  // Sólo manejamos peticiones GET.
  if (request.method !== 'GET') return;

  event.respondWith(
    caches.match(request).then(cachedResponse => {
      if (cachedResponse) return cachedResponse;

      // Si no está en cache, vamos a la red.
      return fetch(request).catch(() => cachedResponse);
    })
  );
});
