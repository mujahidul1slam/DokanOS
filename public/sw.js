// OmniSync minimal service worker — required so the browser treats the site
// as an installable PWA (enables proper "Install app" prompt + app drawer entry on Android).
// Strategy: network-first for navigation, cache-first for static assets, never cache API/auth.

const CACHE = "omnisync-v2";
const CORE = ["/manifest.webmanifest", "/app-icon-192.png", "/app-icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never intercept API / auth / supabase / OAuth / cross-origin POSTs
  if (
    url.pathname.startsWith("/~oauth") ||
    url.hostname.includes("supabase") ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/functions/")
  ) {
    return;
  }

  // Do NOT intercept navigation requests. Letting the browser handle them
  // preserves the back-forward cache (bfcache) and prevents the PWA / tab
  // from doing a full page reload every time the user switches tabs or
  // brings the installed app back to the foreground.
  if (req.mode === "navigate") {
    return;
  }

  // Static assets: cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            const copy = res.clone();
            if (res.status === 200) {
              caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            }
            return res;
          })
      )
    );
  }
});
