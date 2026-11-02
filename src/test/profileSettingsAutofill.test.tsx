import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ProfileSettingsTab from "@/components/settings/ProfileSettingsTab";

/**
 * Regression: password-manager autofill must not mark the settings tab dirty.
 *
 * Autofill fills values and fires input/change, but never a user gesture
 * (beforeinput/keydown/paste). The tab therefore reported "unsaved changes"
 * on every load for users with a password manager, and the route-away guard
 * then blocked the whole UI (dark modal, dead clicks) on innocuous clicks
 * like expanding a sidebar group.
 */

const dirtyCalls: boolean[] = [];

vi.mock("@/hooks/useSettingsDirty", () => ({
  useRegisterDirty: () => (dirty: boolean) => {
    dirtyCalls.push(dirty);
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "tester@example.com" },
    role: "admin",
    isAdmin: true,
    signOut: vi.fn(),
  }),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ canAny: () => true }),
}));

vi.mock("@/lib/auditLog", () => ({ logChange: vi.fn(async () => {}) }));

vi.mock("@/integrations/supabase/client", () => {
  const eq = vi.fn(() => ({
    maybeSingle: vi.fn(async () => ({ data: null })),
    update: vi.fn(() => ({ eq: vi.fn(async () => ({ data: null, error: null })) })),
  }));
  return {
    supabase: {
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq })),
        update: vi.fn(() => ({ eq: vi.fn(async () => ({ data: null, error: null })) })),
        insert: vi.fn(() => ({ select: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null })) })) })),
      })),
      auth: {
        getAuthenticatorAssuranceLevel: vi.fn(async () => ({ data: { current: "aal1", next: "aal1" } })),
        mfa: { listFactors: vi.fn(async () => ({ data: { totp: [], all: [] } })) },
        updateUser: vi.fn(async () => ({ error: null })),
        signInWithPassword: vi.fn(async () => ({ error: null })),
      },
    },
  };
});

/** Simulate a password-manager fill: value + input/change, no user gesture. */
const autofill = (input: HTMLElement, value: string) => {
  fireEvent.input(input, { target: { value } });
  fireEvent.change(input, { target: { value } });
};

/** Simulate a real edit: a keyboard gesture precedes the input event. */
const typeEdit = (input: HTMLElement, value: string) => {
  fireEvent.keyDown(input, { key: value.slice(-1) });
  fireEvent.input(input, { target: { value } });
};

describe("ProfileSettingsTab dirty state vs password-manager autofill", () => {
  beforeEach(() => {
    dirtyCalls.length = 0;
  });

  it("stays clean when the New Password field is autofilled", async () => {
    render(<ProfileSettingsTab />);
    const input = await screen.findByLabelText("New Password");
    autofill(input, "SavedPass123!");
    expect(dirtyCalls[dirtyCalls.length - 1]).not.toBe(true);
  });

  it("stays clean when the Current Password (email change) field is autofilled", async () => {
    render(<ProfileSettingsTab />);
    const input = await screen.findByLabelText("Current Password");
    autofill(input, "SavedPass123!");
    expect(dirtyCalls[dirtyCalls.length - 1]).not.toBe(true);
  });

  it("goes dirty once the user actually edits a credential field", async () => {
    render(<ProfileSettingsTab />);
    const input = await screen.findByLabelText("New Password");
    typeEdit(input, "x");
    expect(dirtyCalls[dirtyCalls.length - 1]).toBe(true);
  });

  it("goes dirty once the user pastes into a credential field", async () => {
    render(<ProfileSettingsTab />);
    const input = await screen.findByLabelText("Confirm New Password");
    fireEvent.paste(input);
    fireEvent.input(input, { target: { value: "pasted" } });
    expect(dirtyCalls[dirtyCalls.length - 1]).toBe(true);
  });
});
