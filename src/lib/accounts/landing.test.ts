import { describe, expect, it } from "vitest";
import {
  defaultToPersist,
  isPostLoginState,
  POST_LOGIN_STATE,
  resolveLanding,
  shownDefaultBusinessId,
  validDefaultBusinessId,
} from "./landing";

// Task 2 (spec §5): the personal default business account controls post-login
// landing only. These cases pin the decision table; the page only acts on it.

const A = "11111111-0000-0000-0000-00000000000a";
const B = "11111111-0000-0000-0000-00000000000b";
const GONE = "11111111-0000-0000-0000-00000000000c";
const one = [{ id: A }];
const two = [{ id: A }, { id: B }];

describe("resolveLanding", () => {
  it("stays on account selection with no memberships so the user can create or join", () => {
    expect(resolveLanding({ businesses: [], defaultBusinessId: A, hasInvitation: false })).toEqual({ kind: "stay" });
  });

  it("never auto-lands while an invitation is pending, even with one business", () => {
    expect(resolveLanding({ businesses: one, defaultBusinessId: null, hasInvitation: true })).toEqual({ kind: "stay" });
    expect(resolveLanding({ businesses: two, defaultBusinessId: B, hasInvitation: true })).toEqual({ kind: "stay" });
  });

  it("auto-selects the sole business when no default is set", () => {
    expect(resolveLanding({ businesses: one, defaultBusinessId: null, hasInvitation: false })).toEqual({
      kind: "land",
      businessId: A,
    });
  });

  it("auto-selects the sole business when the default is undefined", () => {
    expect(resolveLanding({ businesses: one, defaultBusinessId: undefined, hasInvitation: false })).toEqual({
      kind: "land",
      businessId: A,
    });
  });

  it("lands on the saved default when it is still a membership, even with several businesses", () => {
    expect(resolveLanding({ businesses: two, defaultBusinessId: B, hasInvitation: false })).toEqual({
      kind: "land",
      businessId: B,
    });
  });

  it("shows the choice for several businesses when no default is set", () => {
    expect(resolveLanding({ businesses: two, defaultBusinessId: null, hasInvitation: false })).toEqual({ kind: "stay" });
    expect(resolveLanding({ businesses: two, defaultBusinessId: undefined, hasInvitation: false })).toEqual({
      kind: "stay",
    });
  });

  it("treats an empty default as unset, so several businesses show the choice", () => {
    expect(resolveLanding({ businesses: two, defaultBusinessId: "", hasInvitation: false })).toEqual({ kind: "stay" });
  });

  it("silently falls back to the sole remaining business when the default was removed", () => {
    expect(resolveLanding({ businesses: one, defaultBusinessId: GONE, hasInvitation: false })).toEqual({
      kind: "land",
      businessId: A,
    });
  });

  it("falls back silently to the first remaining business when the default was removed and several remain (spec §5)", () => {
    expect(resolveLanding({ businesses: two, defaultBusinessId: GONE, hasInvitation: false })).toEqual({
      kind: "land",
      businessId: A,
    });
  });
});

describe("validDefaultBusinessId", () => {
  it("keeps the default only while the user is still a member of it", () => {
    expect(validDefaultBusinessId(two, B)).toBe(B);
    expect(validDefaultBusinessId(two, GONE)).toBeNull();
    expect(validDefaultBusinessId(two, null)).toBeNull();
    expect(validDefaultBusinessId(two, undefined)).toBeNull();
  });
});

describe("shownDefaultBusinessId", () => {
  it("shows the live default", () => {
    expect(shownDefaultBusinessId(two, B)).toBe(B);
  });

  it("shows the first remaining business once the saved default was removed, matching landing", () => {
    expect(shownDefaultBusinessId(two, GONE)).toBe(A);
    expect(shownDefaultBusinessId(one, GONE)).toBe(A);
  });

  it("shows nothing when no default was ever set", () => {
    expect(shownDefaultBusinessId(two, null)).toBeNull();
    expect(shownDefaultBusinessId(two, undefined)).toBeNull();
    expect(shownDefaultBusinessId(two, "")).toBeNull();
  });

  it("agrees with the landing decision for every default state", () => {
    for (const defaultBusinessId of [B, GONE, null, undefined, ""]) {
      const shown = shownDefaultBusinessId(two, defaultBusinessId);
      const decision = resolveLanding({ businesses: two, defaultBusinessId, hasInvitation: false });
      if (shown) expect(decision).toEqual({ kind: "land", businessId: shown });
      else expect(decision).toEqual({ kind: "stay" });
    }
  });
});

describe("defaultToPersist", () => {
  it("leaves an untouched default alone, even when it is now dead", () => {
    expect(defaultToPersist({ current: GONE, original: GONE })).toBeUndefined();
    expect(defaultToPersist({ current: "", original: null })).toBeUndefined();
  });

  it("persists a deliberate change to a business", () => {
    expect(defaultToPersist({ current: B, original: GONE })).toBe(B);
    expect(defaultToPersist({ current: B, original: null })).toBe(B);
  });

  it("persists a deliberate clear as null, so landing falls back to the picker", () => {
    expect(defaultToPersist({ current: "", original: B })).toBeNull();
  });
});

describe("isPostLoginState", () => {
  it("marks only the post-login arrival, not ordinary visits", () => {
    expect(isPostLoginState(POST_LOGIN_STATE)).toBe(true);
    expect(isPostLoginState({ postLogin: true })).toBe(true);
    expect(isPostLoginState(null)).toBe(false);
    expect(isPostLoginState(undefined)).toBe(false);
    expect(isPostLoginState({ postLogin: false })).toBe(false);
    expect(isPostLoginState("postLogin")).toBe(false);
  });
});
