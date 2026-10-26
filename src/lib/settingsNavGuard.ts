import { useLayoutEffect, useRef } from "react";

/**
 * Route-away guard for the settings page (issue #25).
 *
 * The app uses <BrowserRouter>, so react-router's useBlocker is unavailable
 * (it needs a data router) — the documented gap in useSettingsDirty.ts. This
 * module closes that gap generically, without touching any caller of
 * navigate() or any link component:
 *
 * 1. `window.history.pushState`/`replaceState` are intercepted. Every SPA
 *    navigation (Link clicks resolve through here too) funnels into these two
 *    methods; when the guard is active and blocking, the call is swallowed.
 *    The router then re-reads `window.location`, sees the unchanged /settings
 *    URL, and never leaves the page — so no edits are lost and nothing flickers.
 * 2. Anchor clicks (sidebar, bottom nav, in-page links) are intercepted in a
 *    document-level capture listener and prevented, so the URL doesn't even
 *    change before the user answers.
 * 3. Back/forward (popstate) cannot be prevented — the URL has already moved.
 *    The handler pins the URL back to /settings synchronously, *before* the
 *    router's own popstate listener reads window.location, so SettingsPage
 *    stays mounted (its form state survives) and the popped entry is restored
 *    on "Stay" or re-taken on proceed.
 *
 * The beforeunload guard for browser close/reload stays in useSettingsDirty.
 */

export type SettingsNavKind = "push" | "replace" | "pop" | "click";

export type SettingsNavTarget = {
  /** How the navigation was attempted. */
  kind: SettingsNavKind;
  /** pathname + search + hash the user tried to reach. */
  path: string;
  /** Complete the intercepted navigation (Discard / Save-and-leave). */
  proceed: () => void;
  /** Cancel the intercepted navigation (Stay). No-op for push/click. */
  cancel: () => void;
};

export type SettingsNavGuardConfig = {
  /** Live check: true while unsaved settings edits exist. */
  isBlocked: () => boolean;
  /** Called synchronously when a navigation is intercepted. */
  onBlocked: (target: SettingsNavTarget) => void;
  /** Performs the deferred SPA navigation for push/replace/click targets. */
  navigateTo: (path: string, opts: { replace: boolean; state: unknown }) => void;
};

/** True for the settings page itself (including nested settings routes). */
export function isSettingsPath(path: string): boolean {
  const pathname = path.split("#")[0].split("?")[0];
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

/** Normalize a pushState/replaceState url argument to pathname + search + hash. */
export function resolveNavPath(url: string | URL | null | undefined, baseHref: string): string {
  if (url == null) {
    try {
      const base = new URL(baseHref);
      return base.pathname + base.search + base.hash;
    } catch {
      return "/";
    }
  }
  try {
    const resolved = new URL(String(url), baseHref);
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    return String(url);
  }
}

/**
 * The state argument of window.history.pushState is the router's entry state
 * ({ usr, key, idx }); navigate() takes the inner user state.
 */
function unwrapUserState(state: unknown): unknown {
  if (state && typeof state === "object" && "usr" in state) {
    return (state as { usr: unknown }).usr;
  }
  return null;
}

function entryIndex(state: unknown): number | null {
  if (state && typeof state === "object" && "idx" in state) {
    const idx = (state as { idx: unknown }).idx;
    return typeof idx === "number" ? idx : null;
  }
  return null;
}

let config: SettingsNavGuardConfig | null = null;
let active = false;
// Reentrant: proceed() callbacks run their own history calls through here.
let bypassDepth = 0;

// Tracked so a blocked back/forward can be undone without losing entries.
let currentUrl = "/";
let currentState: unknown = null;
let pendingPopPath: string | null = null;

function currentPath(): string {
  return window.location.pathname + window.location.search + window.location.hash;
}

function trackCurrent(state: unknown, path: string): void {
  currentState = state;
  currentUrl = path;
}

function bypassed(fn: () => void): void {
  bypassDepth += 1;
  try {
    fn();
  } finally {
    bypassDepth -= 1;
  }
}

function isBypassing(): boolean {
  return bypassDepth > 0;
}

/** Tell the router its location changed (it listens for popstate). */
function notifyRouter(state: unknown): void {
  const event = new PopStateEvent("popstate", { state });
  bypassed(() => window.dispatchEvent(event));
}

function shouldIntercept(path: string): boolean {
  return active && !isBypassing() && config !== null && config.isBlocked() && !isSettingsPath(path);
}

function intercept(kind: SettingsNavKind, path: string, doProceed: () => void): void {
  const cfg = config;
  if (!cfg) return;
  cfg.onBlocked({
    kind,
    path,
    proceed: () => bypassed(doProceed),
    cancel: () => {},
  });
}

function onPopState(event: PopStateEvent): void {
  const target = currentPath();
  if (!active || isBypassing() || isSettingsPath(target) || !config?.isBlocked()) {
    trackCurrent(event.state, target);
    return;
  }

  // Back/forward while dirty. The URL has already moved, so pin it back to the
  // guarded page before the router's popstate listener reads window.location.
  // The popped entry keeps its identity (we save its state first) so "Stay"
  // can restore it and proceed can re-take it without corrupting history.
  const poppedPath = target;
  const poppedState = event.state;
  const settingsState = currentState;
  const settingsUrl = currentUrl;
  pendingPopPath = poppedPath;
  window.history.replaceState(settingsState, "", settingsUrl);

  const cfg = config;
  if (!cfg) return;
  const stillCurrent = () => pendingPopPath === poppedPath && currentPath() === settingsUrl;

  cfg.onBlocked({
    kind: "pop",
    path: poppedPath,
    proceed: () => {
      if (!stillCurrent()) {
        // History moved on while the dialog was open — just navigate there.
        pendingPopPath = null;
        bypassed(() => cfg.navigateTo(poppedPath, { replace: false, state: unwrapUserState(poppedState) }));
        return;
      }
      pendingPopPath = null;
      bypassed(() => {
        window.history.replaceState(poppedState, "", poppedPath);
        notifyRouter(poppedState);
      });
    },
    cancel: () => {
      if (!stillCurrent()) {
        pendingPopPath = null;
        return;
      }
      pendingPopPath = null;
      const delta = (entryIndex(poppedState) ?? 0) - (entryIndex(settingsState) ?? 0);
      bypassed(() => {
        window.history.replaceState(poppedState, "", poppedPath);
        if (entryIndex(poppedState) !== null && entryIndex(settingsState) !== null) {
          // Undo the pop; the follow-up popstate targets /settings and passes.
          window.history.go(-delta);
        } else {
          // No index bookkeeping (entry created outside the router): return by
          // pushing the guarded page instead of traversing.
          window.history.pushState(settingsState, "", settingsUrl);
          notifyRouter(settingsState);
        }
      });
    },
  });
}

function onDocumentClickCapture(event: MouseEvent): void {
  if (!active || isBypassing() || !config?.isBlocked() || event.defaultPrevented) return;
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

  const target = event.target;
  const anchor = target instanceof Element ? target.closest("a[href]") : null;
  if (!(anchor instanceof HTMLAnchorElement)) return;
  if (anchor.hasAttribute("download")) return;
  const anchorTarget = anchor.getAttribute("target");
  if (anchorTarget && anchorTarget.toLowerCase() !== "_self") return;

  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;

  let url: URL;
  try {
    url = new URL(anchor.href);
  } catch {
    return;
  }
  if (url.origin !== window.location.origin) return;

  const path = url.pathname + url.search + url.hash;
  if (isSettingsPath(path)) return;

  // Prevent the navigation before react-router's own click handler sees it
  // (Link skips navigation for defaultPrevented events).
  event.preventDefault();
  intercept("click", path, () =>
    config?.navigateTo(path, { replace: false, state: null }),
  );
}

let installed = false;

function install(): void {
  if (installed || typeof window === "undefined" || typeof document === "undefined") return;
  installed = true;

  const originalPushState = window.history.pushState.bind(window.history);
  const originalReplaceState = window.history.replaceState.bind(window.history);

  window.history.pushState = function patchedPushState(data, unused, url) {
    const path = resolveNavPath(url, window.location.href);
    if (shouldIntercept(path)) {
      intercept("push", path, () =>
        config?.navigateTo(path, { replace: false, state: unwrapUserState(data) }),
      );
      return;
    }
    originalPushState(data, unused, url);
    trackCurrent(data, path);
  };

  window.history.replaceState = function patchedReplaceState(data, unused, url) {
    const path = resolveNavPath(url, window.location.href);
    if (shouldIntercept(path)) {
      intercept("replace", path, () =>
        config?.navigateTo(path, { replace: true, state: unwrapUserState(data) }),
      );
      return;
    }
    originalReplaceState(data, unused, url);
    trackCurrent(data, path);
  };

  // Registered at module load — before the router's own popstate listener —
  // so onPopState always pins the URL before the router reads it.
  window.addEventListener("popstate", onPopState);
  document.addEventListener("click", onDocumentClickCapture, true);
}

install();

/**
 * Activate the guard while the settings page is mounted. Returns deactivation.
 */
export function activateSettingsNavGuard(next: SettingsNavGuardConfig): () => void {
  install();
  config = next;
  active = true;
  pendingPopPath = null;
  trackCurrent(window.history.state, currentPath());
  return () => {
    active = false;
    config = null;
    pendingPopPath = null;
  };
}

/**
 * React binding: activate the guard for the lifetime of the calling component.
 * The config is read through a ref so callbacks always see fresh state.
 */
export function useSettingsNavGuard(next: SettingsNavGuardConfig): void {
  const latest = useRef(next);
  latest.current = next;
  useLayoutEffect(() => {
    return activateSettingsNavGuard({
      isBlocked: () => latest.current.isBlocked(),
      onBlocked: (target) => latest.current.onBlocked(target),
      navigateTo: (path, opts) => latest.current.navigateTo(path, opts),
    });
  }, []);
}

/** Test-only: clear activation state and pending interception bookkeeping. */
export function resetSettingsNavGuardForTests(): void {
  active = false;
  config = null;
  bypassDepth = 0;
  pendingPopPath = null;
  trackCurrent(typeof window !== "undefined" ? window.history.state : null, "/");
}
