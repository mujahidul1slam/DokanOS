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
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      await Promise.all(
        clients.map((client) => {
          const url = new URL(client.url);
          if (!url.searchParams.has("sw-cleanup")) {
            url.searchParams.set("sw-cleanup", Date.now().toString());
            return client.navigate(url.toString());
          }
          return undefined;
        })
      );
      await self.registration.unregister();
    })()
  );
});
