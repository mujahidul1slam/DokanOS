import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  activateSettingsNavGuard,
  isSettingsPath,
  resetSettingsNavGuardForTests,
  resolveNavPath,
  type SettingsNavTarget,
} from "@/lib/settingsNavGuard";

describe("isSettingsPath", () => {
  it("treats /settings and nested settings routes as inside", () => {
    expect(isSettingsPath("/settings")).toBe(true);
    expect(isSettingsPath("/settings?tab=brands")).toBe(true);
    expect(isSettingsPath("/settings/advanced")).toBe(true);
    expect(isSettingsPath("/settings#top")).toBe(true);
  });

  it("treats every other app route as outside", () => {
    expect(isSettingsPath("/")).toBe(false);
    expect(isSettingsPath("/orders")).toBe(false);
    expect(isSettingsPath("/settingsx")).toBe(false);
    expect(isSettingsPath("/products?tab=all")).toBe(false);
  });
});

describe("resolveNavPath", () => {
  const base = "http://localhost:3000/settings?tab=inventory";

  it("keeps the current path when the url argument is omitted", () => {
    expect(resolveNavPath(null, base)).toBe("/settings?tab=inventory");
    expect(resolveNavPath(undefined, base)).toBe("/settings?tab=inventory");
  });

  it("resolves absolute paths, relative paths and URLs", () => {
    expect(resolveNavPath("/orders?open=1", base)).toBe("/orders?open=1");
    expect(resolveNavPath("orders", base)).toBe("/orders");
    expect(resolveNavPath(new URL("http://localhost:3000/customers#x"), base)).toBe("/customers#x");
  });
});

describe("settingsNavGuard interception", () => {
  let blocked: boolean;
  let intercepted: SettingsNavTarget[];
  let navigateTo: ReturnType<typeof vi.fn>;
  let deactivate: () => void;

  /**
   * Emulate the browser moving the joint session history on Back/Forward:
   * the URL changes WITHOUT history.pushState/replaceState being called, so
   * use the native prototype method (the guard patches the history instance).
   */
  const emulateBackTo = (state: unknown, url: string) => {
    History.prototype.replaceState.call(window.history, state, "", url);
    window.dispatchEvent(new PopStateEvent("popstate", { state }));
  };

  beforeEach(() => {
    resetSettingsNavGuardForTests();
    window.history.replaceState({ usr: null, idx: 1 }, "", "/settings");
    blocked = true;
    intercepted = [];
    navigateTo = vi.fn((path: string, opts: { replace: boolean; state: unknown }) => {
      // Fake the shell's navigate(): a real history move the guard lets pass.
      window.history.pushState({ usr: opts.state, idx: 1 }, "", path);
    });
    deactivate = activateSettingsNavGuard({
      isBlocked: () => blocked,
      onBlocked: (target) => intercepted.push(target),
      navigateTo,
    });
  });

  afterEach(() => {
    deactivate();
    resetSettingsNavGuardForTests();
    window.history.replaceState({}, "", "/settings");
  });

  it("swallows pushState to another route while dirty and keeps the URL", () => {
    window.history.pushState({ usr: null, idx: 2 }, "", "/orders");
    expect(window.location.pathname).toBe("/settings");
    expect(intercepted).toHaveLength(1);
    expect(intercepted[0].kind).toBe("push");
    expect(intercepted[0].path).toBe("/orders");
  });

  it("completes the navigation on proceed()", () => {
    window.history.pushState({ usr: null, idx: 2 }, "", "/orders");
    intercepted[0].proceed();
    expect(navigateTo).toHaveBeenCalledWith("/orders", { replace: false, state: null });
    expect(window.location.pathname).toBe("/orders");
  });

  it("cancel() keeps the user on the settings page", () => {
    window.history.pushState({ usr: null, idx: 2 }, "", "/orders");
    intercepted[0].cancel();
    expect(window.location.pathname).toBe("/settings");
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it("intercepts replaceState as well", () => {
    window.history.replaceState({ usr: null, idx: 1 }, "", "/analytics");
    expect(window.location.pathname).toBe("/settings");
    expect(intercepted[0].kind).toBe("replace");
  });

  it("lets settings-internal url changes through while dirty", () => {
    window.history.pushState({ usr: null, idx: 2 }, "", "/settings?tab=brands");
    expect(window.location.pathname).toBe("/settings");
    expect(window.location.search).toBe("?tab=brands");
    expect(intercepted).toHaveLength(0);
  });

  it("lets navigation through when the tabs are clean", () => {
    blocked = false;
    window.history.pushState({ usr: null, idx: 2 }, "", "/orders");
    expect(window.location.pathname).toBe("/orders");
    expect(intercepted).toHaveLength(0);
  });

  it("prevents anchor clicks to another route while dirty", () => {
    const anchor = document.createElement("a");
    anchor.href = "/orders";
    anchor.textContent = "Orders";
    document.body.appendChild(anchor);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);
    anchor.remove();

    expect(event.defaultPrevented).toBe(true);
    expect(intercepted).toHaveLength(1);
    expect(intercepted[0].kind).toBe("click");
    expect(intercepted[0].path).toBe("/orders");
  });

  it("ignores clicks on expand-only controls nested inside anchors", () => {
    // Sidebar group expander chevrons live inside their nav anchor; clicking
    // one only expands the submenu — it must never be treated as navigation.
    const anchor = document.createElement("a");
    anchor.href = "/orders";
    const chevron = document.createElement("div");
    chevron.setAttribute("data-nav-expander", "");
    anchor.appendChild(chevron);
    document.body.appendChild(anchor);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    let preventedAtTarget = false;
    chevron.addEventListener("click", (e) => {
      preventedAtTarget = e.defaultPrevented;
      e.preventDefault();
    });
    chevron.dispatchEvent(event);
    anchor.remove();

    expect(preventedAtTarget).toBe(false);
    expect(intercepted).toHaveLength(0);
  });

  it("leaves anchor clicks to settings routes alone", () => {
    const anchor = document.createElement("a");
    anchor.href = "/settings?tab=pos";
    document.body.appendChild(anchor);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    // Probe after the guard's capture listener; then suppress jsdom's
    // unimplemented navigation default action.
    let preventedByGuard = true;
    const probe = (e: MouseEvent) => {
      preventedByGuard = e.defaultPrevented;
      e.preventDefault();
    };
    document.addEventListener("click", probe, true);
    anchor.dispatchEvent(event);
    document.removeEventListener("click", probe, true);
    anchor.remove();

    expect(preventedByGuard).toBe(false);
    expect(intercepted).toHaveLength(0);
  });

  it("pins the url back on blocked back/forward (popstate)", () => {
    // Emulate a Back press: the browser has already moved to the popped entry.
    emulateBackTo({ usr: null, idx: 0 }, "/orders");

    // The router must still see /settings, so the page and edits survive.
    expect(window.location.pathname).toBe("/settings");
    expect(intercepted).toHaveLength(1);
    expect(intercepted[0].kind).toBe("pop");
    expect(intercepted[0].path).toBe("/orders");
  });

  it("restores the popped entry and undoes the pop on cancel()", () => {
    const goSpy = vi.spyOn(window.history, "go").mockImplementation(() => {});
    emulateBackTo({ usr: null, idx: 0 }, "/orders");
    intercepted[0].cancel();

    // Entry restored (Back button history intact) and traversal undoes the pop.
    expect(window.location.pathname).toBe("/orders");
    expect(goSpy).toHaveBeenCalledWith(1);
    goSpy.mockRestore();
  });

  it("re-takes the popped entry on proceed()", () => {
    const notified: PopStateEvent[] = [];
    const listener = (e: PopStateEvent) => notified.push(e);
    window.addEventListener("popstate", listener);
    emulateBackTo({ usr: null, idx: 0 }, "/orders");
    expect(intercepted).toHaveLength(1);
    notified.length = 0;

    intercepted[0].proceed();

    expect(window.location.pathname).toBe("/orders");
    // The router is told the location changed (it listens for popstate).
    expect(notified).toHaveLength(1);
    window.removeEventListener("popstate", listener);
  });
});
