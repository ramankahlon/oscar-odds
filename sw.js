// Bump this string whenever the shell assets change to invalidate the old cache.
const CACHE = "oscar-odds-shell-v1";

// The minimal set of resources that make the app usable offline.
const SHELL = ["/", "/styles.css", "/app.js"];

// ── Install ──────────────────────────────────────────────────────────────────
// Pre-cache the app shell so the first offline visit works immediately.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL))
  );
  // Activate the new SW straight away rather than waiting for existing tabs to close.
  self.skipWaiting();
});

// ── Activate ─────────────────────────────────────────────────────────────────
// Purge caches from any previous SW version so stale assets don't linger.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      )
    )
  );
  // Take control of all open tabs without requiring a reload.
  self.clients.claim();
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only intercept same-origin GET requests.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // API routes (REST + SSE stream): always go straight to the network.
  // Caching SSE or dynamic forecast data would break real-time updates.
  if (url.pathname.startsWith("/api/")) return;

  // Navigation requests (full-page loads, including share URLs with ?share=…):
  // return the cached shell so the app loads offline, then JS handles routing.
  if (request.mode === "navigate") {
    event.respondWith(
      caches
        .match("/")
        .then((cached) => cached ?? fetch(request))
        .catch(() => caches.match("/"))
    );
    return;
  }

  // All other same-origin GET requests (styles, scripts, images, fonts, …):
  // cache-first — serve from cache, fall back to network and store the result.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
