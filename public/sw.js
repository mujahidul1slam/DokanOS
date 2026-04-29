// Service worker kill-switch.
// OmniSync only needs the manifest for installability; keeping a worker active
// can make installed PWAs / restored tabs reload or serve stale cached shells.

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
      await self.registration.unregister();
    })()
  );
});
