const CHUNK_RECOVERY_KEY = "omnisync-chunk-recovery";

/** Max reloads allowed within the window before we stop and show the error UI. */
const MAX_RECOVERY_ATTEMPTS = 2;
const RECOVERY_WINDOW_MS = 60_000;

interface RecoveryState {
  count: number;
  firstAttemptAt: number;
}

function readState(): RecoveryState | null {
  try {
    const raw = sessionStorage.getItem(CHUNK_RECOVERY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RecoveryState>;
    if (typeof parsed.count !== "number" || typeof parsed.firstAttemptAt !== "number") return null;
    return { count: parsed.count, firstAttemptAt: parsed.firstAttemptAt };
  } catch {
    return null;
  }
}

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
  const now = Date.now();
  const prev = readState();

  // Reset the counter when the previous attempt was long ago.
  const state: RecoveryState =
    prev && now - prev.firstAttemptAt < RECOVERY_WINDOW_MS
      ? prev
      : { count: 0, firstAttemptAt: now };

  if (state.count >= MAX_RECOVERY_ATTEMPTS) {
    // Give up — persistent chunk failures get the error UI, not a reload loop.
    return false;
  }

  sessionStorage.setItem(
    CHUNK_RECOVERY_KEY,
    JSON.stringify({ count: state.count + 1, firstAttemptAt: state.firstAttemptAt } satisfies RecoveryState),
  );
  await clearRuntimeCaches().catch(() => undefined);
  window.location.reload();
  return true;
};

export const markAppLoaded = () => {
  sessionStorage.removeItem(CHUNK_RECOVERY_KEY);
};