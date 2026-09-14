import { createContext, useCallback, useContext, useEffect, useState } from "react";

/**
 * W6: dirty-state registry for the settings page.
 *
 * Tabs register their dirty state (RHF tabs report formState.isDirty;
 * immediate-save tabs register false). The page routes every user-facing tab
 * switch through a chokepoint that prompts before discarding, and holds a
 * beforeunload listener while any tab is dirty.
 *
 * Note: SPA route navigation away from /settings is NOT blocked — useBlocker
 * requires a data router and this app uses <BrowserRouter>. Documented gap.
 */
export function useSettingsDirty() {
  const [dirtyTabs, setDirtyTabs] = useState<Set<string>>(new Set());

  const registerDirty = useCallback((tabId: string, isDirty: boolean) => {
    setDirtyTabs((prev) => {
      const next = new Set(prev);
      if (isDirty) next.add(tabId);
      else next.delete(tabId);
      return next;
    });
  }, []);

  const isDirty = dirtyTabs.size > 0;

  // Warn on close/reload while any tab has unsaved edits.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  return { registerDirty, isDirty };
}

/**
 * Tabs call setDirty(isDirty); the page resolves it against the active tab.
 * The active tab IS the tab being edited, so tabs never need their own id.
 */
export const SettingsDirtyContext = createContext<(isDirty: boolean) => void>(() => {});
export const useRegisterDirty = () => useContext(SettingsDirtyContext);