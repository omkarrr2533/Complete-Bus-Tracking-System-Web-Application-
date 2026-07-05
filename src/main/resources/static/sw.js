// CityBus Tracker service worker.
// Network-first for app code (HTML/JS/CSS) so deployments reach users
// immediately; the cache only serves as an offline fallback.
const CACHE_NAME = 'citybus-v2';
const PRECACHE = [
  '/',
  '/styles.css',
  '/script.js',
  '/eta.js',
  '/chatbot.js',
  '/animation.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept API calls, WebSocket upgrades or cross-origin requests.
  if (event.request.method !== 'GET'
      || url.origin !== self.location.origin
      || url.pathname.startsWith('/api/')
      || url.pathname.startsWith('/websocket')
      || url.pathname.startsWith('/actuator')
      || url.pathname.startsWith('/h2-console')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
