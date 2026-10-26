import { useEffect, useRef } from "react";

/**
 * Settings save registry (issue #25, sticky save bar).
 *
 * Every `SaveButton` inside a settings tab registers its save handler here for
 * as long as it is mounted. The sticky save bar (and the route-away dialog)
 * then "save from the bar" generically — without the individual tabs knowing
 * anything about the bar.
 *
 * Only the active settings tab is mounted at a time, so the registry holds at
 * most one tab's handlers. Tabs that persist immediately (no SaveButton) never
 * register and never need to.
 */

export type SettingsSaveEntry = {
  /** Stable id from the mounting SaveButton. */
  id: string;
  /** Button label; used to pick the primary save action (see below). */
  label: string;
  /** True while the button would be un-clickable (saving or disabled). */
  disabled: boolean;
  /** The button's own onClick. May return a promise the bar awaits. */
  run: () => void | Promise<void>;
};

let entries: SettingsSaveEntry[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

/** Register a save handler. Returns an unregister function. */
export function registerSettingsSave(entry: SettingsSaveEntry): () => void {
  entries = [...entries.filter((e) => e.id !== entry.id), entry];
  emit();
  return () => {
    entries = entries.filter((e) => e.id !== entry.id);
    emit();
  };
}

export function subscribeSettingsSave(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSettingsSaveEntries(): SettingsSaveEntry[] {
  return entries;
}

/**
 * Pick which handlers a tab-level "Save" should run.
 *
 * Buttons labelled "Save …" (the default `Save Changes` included) are the
 * primary save actions; when at least one is enabled it runs alone. Secondary
 * action buttons that share the SaveButton shell (e.g. "Create Business",
 * "Update Password") are only used as a fallback when no primary save exists,
 * so the bar never fires a side action on a tab that has a real save button.
 */
export function pickSettingsSaveTargets(all: SettingsSaveEntry[]): SettingsSaveEntry[] {
  const enabled = all.filter((e) => !e.disabled);
  const primary = enabled.filter((e) => e.label.trim().toLowerCase().startsWith("save"));
  return primary.length > 0 ? primary : enabled;
}

/**
 * Run the active tab's save handlers, in mount order. Returns false when any
 * handler threw (tabs that swallow their own errors and toast are tracked via
 * the dirty registry instead — the caller re-checks dirty state afterwards).
 */
export async function runSettingsSaveHandlers(): Promise<boolean> {
  const targets = pickSettingsSaveTargets(getSettingsSaveEntries());
  let ok = true;
  for (const target of targets) {
    try {
      await target.run();
    } catch {
      ok = false;
    }
  }
  return ok;
}

/**
 * Registration hook used by SaveButton. `run` is read through a ref so the
 * latest onClick is always invoked without re-registering every render.
 */
export function useRegisterSettingsSave(
  id: string,
  entry: { label: string; disabled: boolean; run: () => void | Promise<void> },
): void {
  const latest = useRef(entry);
  latest.current = entry;
  const { label, disabled } = entry;
  useEffect(() => {
    return registerSettingsSave({
      id,
      label,
      disabled,
      run: () => latest.current.run(),
    });
  }, [id, label, disabled]);
}

/** Test-only: drop all registrations and listeners between cases. */
export function resetSettingsSaveRegistryForTests(): void {
  entries = [];
  listeners.clear();
}
