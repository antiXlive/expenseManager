// Expense Manager PWA Service Worker

const CACHE_NAME = "expense-pwa-v1";
const APP_SHELL = [
  "index.html",
  "app.css",
  "app.js",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  if (req.url.endsWith(".json")) {
    event.respondWith(networkFirst(req));
  } else {
    event.respondWith(cacheFirst(req));
  }
});

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    return fresh;
  } catch {
    return cached || new Response("Offline", { status: 503 });
  }
}

async function networkFirst(req) {
  try {
    const fresh = await fetch(req);
    const cache = await caches.open(CACHE_NAME);
    cache.put(req, fresh.clone());
    return fresh;
  } catch {
    const cached = await caches.match(req);
    return cached || new Response("Offline", { status: 503 });
  }
}
