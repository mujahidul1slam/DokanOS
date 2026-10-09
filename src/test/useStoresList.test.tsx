import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// D-17 seam test: context and client are module-mocked (never instantiated).
// Precedent: src/test/invoiceHtml.test.ts.
vi.mock("@/hooks/useBusinessContext", () => ({
  useBusinessContext: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn() },
}));

import { useBusinessContext } from "@/hooks/useBusinessContext";
import { supabase } from "@/integrations/supabase/client";
import { useStoresList } from "@/hooks/useStoresList";

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

describe("useStoresList (fail-closed, R3-a)", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("fails closed: active business with zero brand-stores returns [] and never issues a stores query", async () => {
    ctxMock.mockReturnValue({ brands: [], active: { id: "b1" }, loading: false });

    const { result } = renderHook(() => useStoresList());

    await waitFor(() => expect(result.current).toEqual([]));
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("scopes the query to the active business's brand-stores via .in(id, ids)", async () => {
    const builder = makeBuilder([{ id: "s1", name: "Store One", status: "connected" }]);
    fromMock.mockReturnValue(builder);
    ctxMock.mockReturnValue({
      brands: [{ woo_store_id: "s1" }],
      active: { id: "b1" },
      loading: false,
    });

    const { result } = renderHook(() => useStoresList());

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(fromMock).toHaveBeenCalledWith("stores");
    expect(builder.in).toHaveBeenCalledWith("id", ["s1"]);
  });

  it("returns [] without querying when there is no business context (null active or outside provider)", async () => {
    ctxMock.mockReturnValue({ brands: [], active: null, loading: false });

    const { result } = renderHook(() => useStoresList());
    await waitFor(() => expect(result.current).toEqual([]));
    expect(fromMock).not.toHaveBeenCalled();

    // Outside-provider path: the context hook throws and is caught — still fail-closed.
    ctxMock.mockImplementation(() => {
      throw new Error("no BusinessContextProvider");
    });
    const outside = renderHook(() => useStoresList());
    await waitFor(() => expect(outside.result.current).toEqual([]));
    expect(fromMock).not.toHaveBeenCalled();
  });
});
