// Bump this string whenever the shell assets change to invalidate the old cache.
const CACHE = "oscar-odds-shell-v2";
const API_CACHE = "oscar-odds-api-v1";

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
  const KEEP = new Set([CACHE, API_CACHE]);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => !KEEP.has(k)).map((k) => caches.delete(k))
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

  // SSE stream: never intercept — it must stay as a live connection.
  if (url.pathname === "/api/scraper-events") return;

  // API routes: network-first, fall back to last-good cached response.
  // On a stale hit the response carries X-Sw-Cached: 1 so the app can show
  // an offline banner while still displaying the cached data.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(API_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(request, { cacheName: API_CACHE }).then((cached) => {
            if (!cached) {
              return new Response(JSON.stringify({ error: "offline" }), {
                status: 503,
                headers: { "Content-Type": "application/json" },
              });
            }
            // Reconstruct with the stale-data signal header.
            const headers = new Headers(cached.headers);
            headers.set("X-Sw-Cached", "1");
            return new Response(cached.body, {
              status: cached.status,
              statusText: cached.statusText,
              headers,
            });
          })
        )
    );
    return;
  }

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
