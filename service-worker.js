// ===============================
//  Expense Manager PWA Service Worker
// ===============================

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

// -------------------------------
// Install SW & Cache App Shell
// -------------------------------
self.addEventListener("install", (event) => {
  console.log("[SW] Installing...");
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[SW] Caching app shell");
      return cache.addAll(APP_SHELL);
    })
  );
  self.skipWaiting();
});

// -------------------------------
// Activate SW
// -------------------------------
self.addEventListener("activate", (event) => {
  console.log("[SW] Activated");
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

// -------------------------------
// Fetch Handler
// -------------------------------
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Network First for dynamic JSON files (exports/imports)
  if (req.url.endsWith(".json")) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Cache First for all app shell files
  event.respondWith(cacheFirst(req));
});

// -------------------------------
// Cache First Strategy
// -------------------------------
async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;

  try {
    const fresh = await fetch(req);
    return fresh;
  } catch (err) {
    return cached || new Response("Offline", { status: 503 });
  }
}

// -------------------------------
// Network First Strategy
// -------------------------------
async function networkFirst(req) {
  try {
    const fresh = await fetch(req);
    const cache = await caches.open(CACHE_NAME);
    cache.put(req, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await caches.match(req);
    return cached || new Response("Offline", { status: 503 });
  }
}
