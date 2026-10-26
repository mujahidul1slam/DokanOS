import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

// Hybrid-tenancy scope seam (issue #16): the ONE place the active business's
// legacy store ids are derived. Context and client are module-mocked (precedent:
// src/test/useStoresList.test.tsx), so no provider or database is needed.

vi.mock("@/hooks/useBusinessContext", () => ({
  useBusinessContext: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn() },
}));

import { useBusinessContext } from "@/hooks/useBusinessContext";
import { supabase } from "@/integrations/supabase/client";
import {
  NO_STORE_IDS,
  hasStoreScope,
  scopeStoreIds,
  selectedStoreScope,
  useActiveBusinessStoreIds,
} from "@/hooks/useActiveBusinessStoreIds";

const ctxMock = useBusinessContext as unknown as Mock;
const fromMock = supabase.from as unknown as Mock;

/** Chainable query-builder mock that resolves like a supabase-js builder. */
const makeBuilder = (data: unknown[] = []) => {
  const b: Record<string, unknown> = {};
  for (const method of ["select", "order", "in", "eq", "maybeSingle"]) {
    b[method] = vi.fn().mockReturnValue(b);
  }
  b.then = (onFulfilled: (v: { data: unknown[]; error: null }) => unknown) =>
    Promise.resolve({ data, error: null }).then(onFulfilled);
  return b;
};

const contextFor = (brands: Array<{ woo_store_id: string | null }>, activeId: string | null = "b1") =>
  ctxMock.mockReturnValue({ brands, active: activeId ? { id: activeId } : null, loading: false, contextReady: true });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useActiveBusinessStoreIds (scope seam)", () => {
  it("derives the scope from the active business's brand-store links", async () => {
    const builder = makeBuilder([{ id: "s1" }, { id: "s2" }]);
    fromMock.mockReturnValue(builder);
    contextFor([{ woo_store_id: "s1" }, { woo_store_id: "s2" }]);

    const { result } = renderHook(() => useActiveBusinessStoreIds());

    await waitFor(() => expect(result.current).toEqual(["s1", "s2"]));
    expect(fromMock).toHaveBeenCalledWith("stores");
    expect(builder.in).toHaveBeenCalledWith("id", ["s1", "s2"]);
  });

  it("fails closed with the shared empty scope and never queries when the business has no brand-stores", async () => {
    contextFor([]);

    const { result } = renderHook(() => useActiveBusinessStoreIds());

    await waitFor(() => expect(result.current).toEqual([]));
    expect(fromMock).not.toHaveBeenCalled();
    // The module constant (not a per-render []) is what keeps effect deps stable.
    expect(result.current).toBe(NO_STORE_IDS);
    expect(hasStoreScope(result.current)).toBe(false);
  });

  it("fails closed when there is no active business", async () => {
    contextFor([{ woo_store_id: "s1" }], null);

    const { result } = renderHook(() => useActiveBusinessStoreIds());

    await waitFor(() => expect(result.current).toBe(NO_STORE_IDS));
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("keeps a stable array identity across renders once loaded", async () => {
    fromMock.mockReturnValue(makeBuilder([{ id: "s1" }]));
    contextFor([{ woo_store_id: "s1" }]);

    const seen: Array<string[]> = [];
    const { result, rerender } = renderHook(() => {
      const ids = useActiveBusinessStoreIds();
      seen.push(ids); // records every render's value, not just the last
      return ids;
    });
    await waitFor(() => expect(result.current).toEqual(["s1"]));

    rerender();
    rerender();
    await waitFor(() => expect(result.current).toEqual(["s1"]));

    const mid = result.current;
    rerender();
    expect(result.current).toBe(mid); // same reference: safe as an effect dependency
    // Once loaded, no render ever produced a different array for the same scope.
    const loaded = seen.filter((ids) => ids.length > 0);
    expect(loaded.length).toBeGreaterThan(1);
    expect(loaded.every((ids) => ids === mid)).toBe(true);
  });

  it("changes the scope when the active business's stores change (switch)", async () => {
    const builder = makeBuilder([{ id: "s1" }]);
    fromMock.mockReturnValue(builder);
    contextFor([{ woo_store_id: "s1" }], "b1");

    const { result, rerender } = renderHook(() => useActiveBusinessStoreIds());
    await waitFor(() => expect(result.current).toEqual(["s1"]));

    // Business switch: new brands ⇒ new store ids ⇒ a different array identity.
    builder.then = (onFulfilled: (v: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: [{ id: "s9" }], error: null }).then(onFulfilled);
    contextFor([{ woo_store_id: "s9" }], "b2");
    rerender();

    await waitFor(() => expect(result.current).toEqual(["s9"]));
  });

  it("scopeStoreIds applies the tenant predicate and selectedStoreScope never widens 'all'", () => {
    const query = makeBuilder();
    scopeStoreIds(query as never, ["s1", "s2"]);
    expect(query.in).toHaveBeenCalledWith("store_id", ["s1", "s2"]);

    // "all" means all stores of the ACTIVE business — never an unscoped read.
    expect(selectedStoreScope("all", ["s1", "s2"])).toEqual({ storeIds: ["s1", "s2"] });
    expect(selectedStoreScope("s2", ["s1", "s2"])).toEqual({ storeIds: ["s2"] });
    expect(selectedStoreScope("pos", ["s1"])).toEqual({ source: "pos", storeIds: ["s1"] });
    // A store filter with no business scope cannot fall back to "everything".
    expect(selectedStoreScope("all", [])).toEqual({ storeIds: [] });
    expect(selectedStoreScope("", ["s1"])).toEqual({ storeIds: [] });
    // A selection outside the active business's stores (a stale one from the
    // previous business) fails closed instead of scoping to that store.
    expect(selectedStoreScope("s9", ["s1", "s2"])).toEqual({ storeIds: [] });
  });
});
