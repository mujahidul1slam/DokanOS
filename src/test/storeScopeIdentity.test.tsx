import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

// Hybrid tenancy (issue #16): the scope array is an EFFECT DEPENDENCY for every
// tenant-scoped read. So its identity must be a function of the store SET, not
// of the order in which that set happened to be emitted: a benign re-emission
// (brands re-read, stores re-fetched) must not look like a business switch,
// because a false scope change clears the scope, fails closed for a render and
// re-sweeps every dashboard query.
//
// Context and client are module-mocked (precedent: src/test/useStoresList.test.tsx).

vi.mock("@/hooks/useBusinessContext", () => ({
  useBusinessContext: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn() },
}));

import { useBusinessContext } from "@/hooks/useBusinessContext";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBusinessStoreIds } from "@/hooks/useActiveBusinessStoreIds";

const ctxMock = useBusinessContext as unknown as Mock;
const fromMock = supabase.from as unknown as Mock;

interface StoreRow {
  id: string;
  name: string;
}

/** Chainable builder whose resolved rows can be swapped between emissions. */
type Builder = {
  rows: (next: StoreRow[]) => Builder;
  then: (onFulfilled: (value: { data: StoreRow[]; error: null }) => unknown) => Promise<unknown>;
} & Record<string, unknown>;

const makeBuilder = (initialRows: StoreRow[]): Builder => {
  const b = {} as Builder;
  let current = initialRows;
  for (const method of ["select", "order", "in", "eq", "maybeSingle"]) {
    b[method] = vi.fn(() => b);
  }
  b.rows = (next: StoreRow[]) => {
    current = next;
    return b;
  };
  b.then = (onFulfilled) => Promise.resolve({ data: current, error: null }).then(onFulfilled);
  return b;
};

const contextFor = (
  brands: Array<{ woo_store_id: string | null }>,
  activeId: string | null = "b1",
) => ctxMock.mockReturnValue({ brands, active: activeId ? { id: activeId } : null, loading: false, contextReady: true });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("scope identity is order-insensitive", () => {
  it("keeps one canonical scope when the same brand-store links arrive in a different order", async () => {
    // Business one's brands: two brand rows pointing at stores s2 and s1. The
    // provider re-reads brands (realtime refresh) and this time emits them in
    // the other order — the SAME store set, so the scope must not change.
    const builder = makeBuilder([{ id: "s2", name: "Store Two" }, { id: "s1", name: "Store One" }]);
    fromMock.mockReturnValue(builder);
    contextFor([{ woo_store_id: "s2" }, { woo_store_id: "s1" }]);

    const seen: string[][] = [];
    const { result, rerender } = renderHook(() => {
      const ids = useActiveBusinessStoreIds();
      seen.push(ids);
      return ids;
    });

    // Canonical (sorted) order, not emission order.
    await waitFor(() => expect(result.current).toEqual(["s1", "s2"]));
    const first = result.current;

    // Benign refresh: same links, new array, different order, and the re-fetched
    // rows come back in a different order too.
    contextFor([{ woo_store_id: "s1" }, { woo_store_id: "s2" }]);
    builder.rows([{ id: "s1", name: "Store One" }, { id: "s2", name: "Store Two" }]);
    rerender();

    await waitFor(() => expect(result.current).toEqual(["s1", "s2"]));

    // The consumer sees the SAME array: no scoped effect re-sweeps for a set
    // that never changed.
    expect(result.current).toBe(first);
    // And no render ever published the fail-closed empty scope after the scope
    // had loaded — a false switch would have flashed "no stores in this
    // business" and cleared the dashboard.
    const loadedAt = seen.findIndex((ids) => ids.length > 0);
    expect(loadedAt).toBeGreaterThanOrEqual(0);
    expect(seen.slice(loadedAt).every((ids) => ids.length > 0)).toBe(true);
  });

  it("keeps one scope when the same stores come back in a different row order", async () => {
    const builder = makeBuilder([{ id: "s1", name: "Store One" }, { id: "s2", name: "Store Two" }]);
    fromMock.mockReturnValue(builder);
    contextFor([{ woo_store_id: "s1" }, { woo_store_id: "s2" }]);

    const seen: string[][] = [];
    const { result, rerender } = renderHook(() => {
      const ids = useActiveBusinessStoreIds();
      seen.push(ids);
      return ids;
    });
    await waitFor(() => expect(result.current).toEqual(["s1", "s2"]));
    const first = result.current;

    // The store list is re-read (new brands array, same links) and returns the
    // same two stores in the opposite row order.
    contextFor([{ woo_store_id: "s1" }, { woo_store_id: "s2" }]);
    builder.rows([{ id: "s2", name: "Store Two" }, { id: "s1", name: "Store One" }]);
    const rendersBefore = seen.length;
    rerender();

    // Wait for the re-read to have actually committed (a further render after
    // the re-render itself), so the assertion below cannot pass by doing nothing.
    await waitFor(() => expect(seen.length).toBeGreaterThan(rendersBefore + 1));
    expect(result.current).toEqual(["s1", "s2"]);
    expect(result.current).toBe(first);
  });

  it("still hands out a NEW scope when the business's stores really change", async () => {
    // The hardening must not blunt the real switch: a different store set is a
    // different scope (or a switch would keep reading the previous business).
    const builder = makeBuilder([{ id: "s1", name: "Store One" }]);
    fromMock.mockReturnValue(builder);
    contextFor([{ woo_store_id: "s1" }], "b1");

    const { result, rerender } = renderHook(() => useActiveBusinessStoreIds());
    await waitFor(() => expect(result.current).toEqual(["s1"]));
    const first = result.current;

    builder.rows([{ id: "s9", name: "Store Nine" }]);
    contextFor([{ woo_store_id: "s9" }], "b2");
    rerender();

    await waitFor(() => expect(result.current).toEqual(["s9"]));
    expect(result.current).not.toBe(first);
  });
});
