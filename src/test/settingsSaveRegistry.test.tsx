import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  getSettingsSaveEntries,
  pickSettingsSaveTargets,
  registerSettingsSave,
  resetSettingsSaveRegistryForTests,
  runSettingsSaveHandlers,
  subscribeSettingsSave,
  type SettingsSaveEntry,
} from "@/lib/settingsSaveRegistry";
import { SaveButton } from "@/components/settings/SettingsSection";

const entry = (id: string, label: string, disabled = false, run: () => void | Promise<void> = () => {}): SettingsSaveEntry => ({
  id,
  label,
  disabled,
  run,
});

beforeEach(() => {
  resetSettingsSaveRegistryForTests();
});

describe("settingsSaveRegistry", () => {
  it("keeps registered handlers and drops them on unregister", () => {
    const offA = registerSettingsSave(entry("a", "Save Profile"));
    registerSettingsSave(entry("b", "Save Business"));
    expect(getSettingsSaveEntries().map((e) => e.id)).toEqual(["a", "b"]);

    offA();
    expect(getSettingsSaveEntries().map((e) => e.id)).toEqual(["b"]);
  });

  it("replaces a registration with the same id", () => {
    registerSettingsSave(entry("a", "Old"));
    registerSettingsSave(entry("a", "New"));
    const entries = getSettingsSaveEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBe("New");
  });

  it("notifies subscribers on every change", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSettingsSave(listener);
    const remove = registerSettingsSave(entry("a", "Save"));
    expect(listener).toHaveBeenCalledTimes(1);
    remove();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    registerSettingsSave(entry("b", "Save"));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("pickSettingsSaveTargets", () => {
  it("prefers buttons labelled Save when they are enabled", () => {
    const targets = pickSettingsSaveTargets([
      entry("save", "Save Profile"),
      entry("pw", "Update Password"),
      entry("biz", "Create Business"),
    ]);
    expect(targets.map((t) => t.id)).toEqual(["save"]);
  });

  it("includes the default Save Changes label", () => {
    const targets = pickSettingsSaveTargets([entry("a", "Save Changes"), entry("b", "Update Email")]);
    expect(targets.map((t) => t.id)).toEqual(["a"]);
  });

  it("skips disabled buttons", () => {
    const targets = pickSettingsSaveTargets([
      entry("a", "Save Profile", true),
      entry("b", "Save Business"),
    ]);
    expect(targets.map((t) => t.id)).toEqual(["b"]);
  });

  it("falls back to all enabled buttons when none are labelled Save", () => {
    const targets = pickSettingsSaveTargets([
      entry("a", "Create Business"),
      entry("b", "Update Password", true),
    ]);
    expect(targets.map((t) => t.id)).toEqual(["a"]);
  });

  it("returns nothing when everything is disabled", () => {
    expect(pickSettingsSaveTargets([entry("a", "Save", true)])).toEqual([]);
  });
});

describe("runSettingsSaveHandlers", () => {
  it("runs the picked handlers in order and reports success", async () => {
    const calls: string[] = [];
    registerSettingsSave(entry("a", "Save A", false, () => { calls.push("a"); }));
    registerSettingsSave(entry("b", "Save B", false, async () => { calls.push("b"); }));
    await expect(runSettingsSaveHandlers()).resolves.toBe(true);
    expect(calls).toEqual(["a", "b"]);
  });

  it("reports failure when a handler throws but keeps running the rest", async () => {
    const calls: string[] = [];
    registerSettingsSave(entry("a", "Save A", false, () => { calls.push("a"); }));
    registerSettingsSave(entry("b", "Save B", false, () => { calls.push("b"); throw new Error("boom"); }));
    await expect(runSettingsSaveHandlers()).resolves.toBe(false);
    expect(calls).toEqual(["a", "b"]);
  });

  it("resolves true with nothing to save", async () => {
    await expect(runSettingsSaveHandlers()).resolves.toBe(true);
  });
});

describe("SaveButton registration", () => {
  it("registers its handler while mounted and unregisters on unmount", () => {
    const onClick = vi.fn();
    const { unmount } = render(<SaveButton onClick={onClick} label="Save Profile" />);

    const entries = getSettingsSaveEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBe("Save Profile");
    expect(entries[0].disabled).toBe(false);

    unmount();
    expect(getSettingsSaveEntries()).toHaveLength(0);
  });

  it("marks the entry disabled while saving or disabled", () => {
    const { rerender } = render(<SaveButton onClick={() => {}} label="Save" disabled />);
    expect(getSettingsSaveEntries()[0].disabled).toBe(true);

    rerender(<SaveButton onClick={() => {}} label="Save" saving />);
    expect(getSettingsSaveEntries()[0].disabled).toBe(true);

    rerender(<SaveButton onClick={() => {}} label="Save" />);
    expect(getSettingsSaveEntries()[0].disabled).toBe(false);
  });

  it("runs its own onClick when the sticky bar saves", async () => {
    const onClick = vi.fn();
    render(<SaveButton onClick={onClick} label="Save Changes" />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);

    await runSettingsSaveHandlers();
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});
