import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Hybrid tenancy (issue #16): StoreHealthGrid used to read EVERY store in the
// system (`from("stores").select(...).order("name")`, no tenant predicate) and
// never re-read on a business switch, so the dashboard's store health card
// listed other businesses' storefronts — and kept listing them after a switch.
//
// The Supabase client and the business context are module-mocked (precedent:
// src/test/appSidebarCategoryScope.test.tsx); the scope seam itself runs for
// real, so this also proves the component is wired to it. The mock HONOURS the
// `.in("id", ...)` predicate, so an unscoped read really does leak the other
// business's store into the assertions.

vi.mock("@/hooks/useBusinessContext", () => ({
  useBusinessContext: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn() },
}));

import { useBusinessContext } from "@/hooks/useBusinessContext";
import { supabase } from "@/integrations/supabase/client";
import StoreHealthGrid from "@/components/dashboard/StoreHealthGrid";

const ctxMock = useBusinessContext as unknown as Mock;
const fromMock = supabase.from as unknown as Mock;

interface StoreRow {
  id: string;
  name: string;
  url: string | null;
  status: string | null;
  last_synced_at: string | null;
}

const STORE_ONE: StoreRow = {
  id: "s1",
  name: "Store One",
  url: "https://one.example.com",
  status: "connected",
  last_synced_at: null,
};
const STORE_NINE: StoreRow = {
  id: "s9",
  name: "Store Nine",
  url: "https://nine.example.com",
  status: "connected",
  last_synced_at: null,
};

/** Every store in the system: both businesses. */
let allStoreRows: StoreRow[] = [STORE_ONE, STORE_NINE];

type Query = { table: string; ids: string[] | null; calls: Array<{ method: string; args: unknown[] }> };
type Pending = {
  query: Query;
  released: boolean;
  resolve: (value: { data: StoreRow[]; error: null }) => void;
};

let queries: Query[] = [];
let deferred: Pending[] = [];
let deferredMode = false;

/** What the database would return for `query`: subject to its .in("id", ids). */
const rowsFor = (query: Query): StoreRow[] => {
  if (query.table !== "stores") return [];
  const ids = query.ids;
  return ids ? allStoreRows.filter((store) => ids.includes(store.id)) : allStoreRows;
};

/** Chainable query-builder mock that records every predicate applied to it. */
const makeBuilder = (query: Query) => {
  const b: Record<string, unknown> = {};
  for (const method of ["select", "order", "eq", "in", "maybeSingle"]) {
    b[method] = vi.fn((...args: unknown[]) => {
      query.calls.push({ method, args });
      if (method === "in" && args[0] === "id") query.ids = args[1] as string[];
      return b;
    });
  }
  b.then = (onFulfilled: (v: { data: StoreRow[]; error: null }) => unknown) =>
    (deferredMode
      ? new Promise<{ data: StoreRow[]; error: null }>((resolve) => {
          deferred.push({ query, released: false, resolve });
        })
      : Promise.resolve({ data: rowsFor(query), error: null })
    ).then(onFulfilled);
  return b;
};

const sameIds = (a: string[] | null, b: string[]) =>
  !!a && a.length === b.length && a.every((id, i) => id === b[i]);

const storeReads = (ids: string[]) => deferred.filter((p) => sameIds(p.query.ids, ids));

/** Resolves the still-pending stores reads scoped to exactly `ids`. */
const releaseStoreReads = async (ids: string[], rows: StoreRow[]) => {
  const targets = storeReads(ids).filter((p) => !p.released);
  await act(async () => {
    targets.forEach((p) => {
      p.released = true;
      p.resolve({ data: rows, error: null });
    });
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
};

const installClient = () => {
  queries = [];
  deferred = [];
  fromMock.mockImplementation((table: string) => {
    const query: Query = { table, ids: null, calls: [] };
    queries.push(query);
    return makeBuilder(query);
  });
};

const contextFor = (
  brands: Array<{ woo_store_id: string | null }>,
  activeId: string | null = "b1",
) => ctxMock.mockReturnValue({ brands, active: activeId ? { id: activeId } : null, loading: false, contextReady: true });

const grid = () => (
  <MemoryRouter>
    <StoreHealthGrid orders={[]} />
  </MemoryRouter>
);

const renderGrid = () => render(grid());

beforeEach(() => {
  fromMock.mockReset();
  allStoreRows = [STORE_ONE, STORE_NINE];
  deferredMode = false;
  installClient();
});

afterEach(() => {
  cleanup();
});

describe("StoreHealthGrid is scoped to the active business's stores", () => {
  it("reads only the active business's stores and never renders another business's store", async () => {
    contextFor([{ woo_store_id: "s1" }]);

    renderGrid();

    expect(await screen.findByText("Store One")).toBeInTheDocument();
    // The other business's storefront is not on this dashboard at all.
    expect(screen.queryByText("Store Nine")).toBeNull();
    // Every stores read the page issued carried the tenant predicate — the
    // scope seam's read and the grid's own read alike, none of them unscoped.
    const storesQueries = queries.filter((q) => q.table === "stores");
    expect(storesQueries.length).toBeGreaterThan(0);
    expect(storesQueries.every((q) => sameIds(q.ids, ["s1"]))).toBe(true);
  });

  it("fails closed when the active business has no mapped stores: no stores read at all", async () => {
    contextFor([]);

    renderGrid();

    await waitFor(() => expect(screen.queryByText("Store One")).toBeNull());
    expect(screen.queryByText("Store Nine")).toBeNull();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("re-reads with the new business's stores when the business is switched", async () => {
    contextFor([{ woo_store_id: "s1" }]);
    const view = renderGrid();
    expect(await screen.findByText("Store One")).toBeInTheDocument();

    const readsBeforeSwitch = queries.length;
    // Switch to a business whose own store is s9.
    contextFor([{ woo_store_id: "s9" }], "b2");
    view.rerender(grid());

    expect(await screen.findByText("Store Nine")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Store One")).toBeNull());
    // Reads issued after the switch are scoped to the NEW business only.
    const after = queries.slice(readsBeforeSwitch).filter((q) => q.table === "stores");
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((q) => sameIds(q.ids, ["s9"]))).toBe(true);
  });

  it("ignores a late response from the previous business's stores read", async () => {
    deferredMode = true;
    contextFor([{ woo_store_id: "s1" }]);
    const view = renderGrid();

    // The scope seam's own read resolves first, then the grid's read is issued.
    await waitFor(() => expect(storeReads(["s1"]).length).toBe(1));
    await releaseStoreReads(["s1"], [STORE_ONE]);
    await waitFor(() => expect(storeReads(["s1"]).length).toBe(2));

    // Switch businesses while business one's grid read is still in flight.
    contextFor([{ woo_store_id: "s9" }], "b2");
    view.rerender(grid());
    await waitFor(() => expect(storeReads(["s9"]).length).toBe(1));
    await releaseStoreReads(["s9"], [STORE_NINE]);
    await waitFor(() => expect(storeReads(["s9"]).length).toBe(2));
    await releaseStoreReads(["s9"], [STORE_NINE]);
    expect(await screen.findByText("Store Nine")).toBeInTheDocument();

    // Business one's response lands after the switch: it must not repaint the
    // new business's grid with the previous business's storefront.
    await releaseStoreReads(["s1"], [STORE_ONE]);
    expect(screen.queryByText("Store One")).toBeNull();
    expect(screen.queryByText(/Store One/)).toBeNull();
  });
});
