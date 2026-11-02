import "@testing-library/jest-dom";

/**
 * Deterministic Web Storage for every vitest environment.
 *
 * Background (measured on this toolchain, node v26.3.1 + jsdom 20 + vitest):
 *   - Node >= 22 defines its own `localStorage` global: an own, configurable
 *     accessor that resolves to `undefined` unless the process was started with
 *     `--localstorage-file`. Reading it emits
 *     "localStorage is not available because --localstorage-file was not
 *     provided" and yields `undefined`.
 *   - vitest's jsdom environment merges jsdom's window keys onto the test global
 *     but skips every key that `k in global` already reports. `localStorage` is
 *     one of those, so jsdom's real Storage is never installed over Node's
 *     placeholder: `'localStorage' in window === true` while
 *     `typeof window.localStorage === 'undefined'`.
 *
 * Consequence in tests only: bare `localStorage.setItem(...)` throws
 * "Cannot read properties of undefined (reading 'clear'|'setItem')", and
 * `src/integrations/supabase/client.ts` (which passes `storage: localStorage` at
 * module scope) is handed `undefined`. Product code is correct — in a browser
 * `window.localStorage` is always defined — so this is fixed in the test
 * environment, never in product code.
 *
 * Behaviour contract for this file:
 *   - a binding is replaced only when it is genuinely unusable, proved by a
 *     set/get round-trip (not a `typeof` check): a real Storage — jsdom's, or
 *     Node's with `--localstorage-file` — is adopted untouched, so this stays a
 *     no-op wherever storage already works;
 *   - an in-memory spec-shaped Storage is installed otherwise, on
 *     `globalThis.localStorage`/`sessionStorage` and mirrored to `window` when
 *     they are distinct objects, so `localStorage` and `window.localStorage`
 *     cannot disagree;
 *   - safe when `window` is absent (node environment): only the globals are
 *     touched;
 *   - the binding stays writable + configurable, so a test that stubs or spies
 *     on storage still wins, and other test files are unaffected.
 */

const PROBE_KEY = "__dokanos-storage-probe__";

type StorageKey = "localStorage" | "sessionStorage";

/** Spec-shaped, per-environment in-memory Storage. */
const createMemoryStorage = (): Storage => {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
    getItem(key: string) {
      const value = entries.get(String(key));
      return value === undefined ? null : value;
    },
    key(index: number) {
      return Array.from(entries.keys())[index] ?? null;
    },
    removeItem(key: string) {
      entries.delete(String(key));
    },
    setItem(key: string, value: string) {
      entries.set(String(key), String(value));
    },
  };
};

/** Reads a global without trusting it: a hostile accessor must not throw here. */
const readBinding = (target: object, key: StorageKey): unknown => {
  try {
    return (target as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
};

/**
 * A binding is usable only when a write is observable by a read. Node's
 * placeholder accessor exists but resolves to `undefined`, so the round-trip —
 * not `typeof` — is what decides.
 */
const isWorkingStorage = (candidate: unknown): candidate is Storage => {
  if (typeof candidate !== "object" || candidate === null) return false;
  const storage = candidate as Partial<Storage>;
  if (
    typeof storage.getItem !== "function" ||
    typeof storage.setItem !== "function" ||
    typeof storage.removeItem !== "function" ||
    typeof storage.clear !== "function" ||
    typeof storage.key !== "function"
  ) {
    return false;
  }
  try {
    const previous = storage.getItem(PROBE_KEY);
    storage.setItem(PROBE_KEY, "1");
    const roundTripped = storage.getItem(PROBE_KEY) === "1";
    if (previous === null) storage.removeItem(PROBE_KEY);
    else storage.setItem(PROBE_KEY, previous);
    return roundTripped;
  } catch {
    return false;
  }
};

const defineStorage = (target: object, key: StorageKey, value: Storage) => {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    configurable: true, // a test (or teardown) can replace the binding again
    enumerable: false, // Window's own accessor is non-enumerable too
  });
};

const globalScope = globalThis as unknown as Record<string, unknown>;
const windowScope =
  typeof window === "undefined" ? null : (window as unknown as Record<string, unknown>);

for (const key of ["localStorage", "sessionStorage"] as const) {
  const globalBinding = readBinding(globalScope, key);
  const windowBinding = windowScope ? readBinding(windowScope, key) : undefined;

  const workingStorage = isWorkingStorage(globalBinding)
    ? globalBinding
    : isWorkingStorage(windowBinding)
      ? windowBinding
      : null;

  if (workingStorage) {
    // Adopt the existing implementation on both scopes when one of them is
    // broken, so the two can never disagree. Pure no-op when both already work.
    if (globalBinding !== workingStorage) defineStorage(globalScope, key, workingStorage);
    if (windowScope && windowScope !== globalScope && windowBinding !== workingStorage) {
      defineStorage(windowScope, key, workingStorage);
    }
    continue;
  }

  const fallback = createMemoryStorage();
  defineStorage(globalScope, key, fallback);
  if (windowScope && windowScope !== globalScope) defineStorage(windowScope, key, fallback);
}

/** jsdom ships no `window.matchMedia`, so provide the inert stub the UI needs. */
const matchMediaMissing = (() => {
  if (windowScope === null) return false;
  try {
    return typeof windowScope.matchMedia !== "function";
  } catch {
    return true;
  }
})();

if (windowScope !== null && matchMediaMissing) {
  Object.defineProperty(windowScope, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });
}
