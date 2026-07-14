const CACHE_NAME = "life-os-v1";
const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/logo.svg",
  "/manifest.json"
];

// Install Event - Pre-cache core shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[Service Worker] Pre-caching core shell assets...");
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event - Clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log("[Service Worker] Removing old cache:", key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Serve with Stale-While-Revalidate or Network-First strategies
self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);

  // Exclude Firebase Realtime Database, Cloud Storage, Auth, or dynamic API routes from SW caching
  if (
    requestUrl.origin.includes("firebase") ||
    requestUrl.origin.includes("googleapis") ||
    requestUrl.pathname.startsWith("/api/")
  ) {
    return; // Let browser and SDK fetch directly
  }

  // Handle navigation requests (SPA routing)
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => {
        // Fallback to index.html if network is offline
        return caches.match("/index.html") || caches.match("/");
      })
    );
    return;
  }

  // Handle static assets with Stale-While-Revalidate
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch fresh copy in background to update cache
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
            }
          })
          .catch(() => { /* Ignore offline fetch errors */ });

        return cachedResponse;
      }

      // If not in cache, fetch from network and cache for future use
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== "basic") {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          // Cache CSS, JS, images, fonts
          if (
            requestUrl.pathname.endsWith(".js") ||
            requestUrl.pathname.endsWith(".css") ||
            requestUrl.pathname.endsWith(".svg") ||
            requestUrl.pathname.endsWith(".png") ||
            requestUrl.pathname.includes("/assets/")
          ) {
            cache.put(event.request, responseToCache);
          }
        });

        return networkResponse;
      });
    })
  );
});
