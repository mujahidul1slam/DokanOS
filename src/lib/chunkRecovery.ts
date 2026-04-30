const CHUNK_RECOVERY_KEY = "omnisync-chunk-recovery-attempted";

const CHUNK_ERROR_PATTERNS = [
  "failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "importing a module script failed",
  "chunkloaderror",
  "loading chunk",
  "modulepreload",
];

export const isChunkLoadError = (error: unknown) => {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "");
  const normalized = message.toLowerCase();

  return CHUNK_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern));
};

export const clearRuntimeCaches = async () => {
  if ("caches" in window) {
    const cacheNames = await window.caches.keys();
    await Promise.all(cacheNames.map((cacheName) => window.caches.delete(cacheName)));
  }

  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }
};

export const recoverFromChunkLoadError = async () => {
  if (sessionStorage.getItem(CHUNK_RECOVERY_KEY) === "true") return false;

  sessionStorage.setItem(CHUNK_RECOVERY_KEY, "true");
  await clearRuntimeCaches().catch(() => undefined);
  window.location.reload();
  return true;
};

export const markAppLoaded = () => {
  sessionStorage.removeItem(CHUNK_RECOVERY_KEY);
};