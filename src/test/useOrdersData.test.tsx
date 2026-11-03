import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

// Context and client are module-mocked (never instantiated) — precedent:
// src/test/useStoresList.test.tsx.
vi.mock("@/hooks/useBusinessContext", () => ({
  useBusinessContext: vi.fn(),
}));
vi.mock("@/hooks/useStoresList", () => ({
  useStoresList: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn() },
}));

import { useBusinessContext } from "@/hooks/useBusinessContext";
import { useStoresList } from "@/hooks/useStoresList";
import { supabase } from "@/integrations/supabase/client";
import { useOrdersData } from "@/pages/orders/useOrdersData";

const ctxMock = useBusinessContext as unknown as Mock;
const storesMock = useStoresList as unknown as Mock;
const fromMock = supabase.from as unknown as Mock;

/**
 * Issue #9 regression tests. The reported bug ("sometimes all the orders
 * don't load, especially new and pre-order") was an intermittent data-loading
 * race: the scope inputs resolve asynchronously, so several load runs overlap
 * and the last *response* used to win — a slow scope-partial response could
 * overwrite the newer full list, and nothing refetched it. The missing rows
 * were the class one scope didn't cover (order-source-only, app-created
 * orders = the "new"/"pre-order" pipeline). These tests drive the overlap
 * deliberately, resolving the OLDER request LAST, which reproduces the exact
 * stuck-partial symptom.
 */

interface QueryResult {
  data: unknown[] | null;
  error: { message: string } | null;
}

interface PendingQuery {
  table: string;
  builder: Record<string, Mock>;
  resolve: (result: QueryResult) => void;
}

/** Every supabase.from() call, in order, with its chainable builder. */
let queries: PendingQuery[] = [];

const queriesFor = (table: string) => queries.filter((q) => q.table === table);

/** A chainable, thenable builder mock resolving like a supabase-js builder. */
function makeBuilder(): { builder: Record<string, any>; resolve: (r: QueryResult) => void } {
  const builder: Record<string, any> = {};
  for (const method of ["select", "order", "in", "eq", "or", "range"]) {
    builder[method] = vi.fn(() => builder);
  }
  let settle!: (r: QueryResult) => void;
  const promise = new Promise<QueryResult>((res) => {
    settle = res;
  });
  // Thenable: `await builder` yields { data, error } like a supabase query.
  builder.then = (onFulfilled: unknown, onRejected: unknown) =>
    (promise as Promise<unknown>).then(onFulfilled as never, onRejected as never);
  return { builder, resolve: settle };
}

/** Let every pending promise chain + React effect settle. */
const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

const resolveQuery = async (query: PendingQuery, result: QueryResult) => {
  await act(async () => {
    query.resolve(result);
    await new Promise((r) => setTimeout(r, 0));
  });
};

const row = (id: string, productId?: string) => ({
  id,
  order_items: productId ? [{ product_id: productId }] : [],
});

beforeEach(() => {
  queries = [];
  ctxMock.mockReset();
  storesMock.mockReset();
  fromMock.mockReset();
  ctxMock.mockReturnValue({ brands: [{ id: "b1", name: "Brand One", woo_store_id: null }], active: { id: "b1" } });
  storesMock.mockReturnValue([]);
  fromMock.mockImplementation((table: string) => {
    const { builder, resolve } = makeBuilder();
    queries.push({ table, builder, resolve });
    return builder;
  });
});

describe("useOrdersData (issue #9)", () => {
  it("a stale scope-partial response never overwrites the newer full list (race regression)", async () => {
    const { result, rerender } = renderHook(() => useOrdersData());

    // Order-source scope fetch is in flight; the row load runs with no
    // scope and shows the placeholder empty state.
    await waitFor(() => expect(queriesFor("order_sources")).toHaveLength(1));

    // Order sources land first → run A (source-scope ONLY: a partial row set,
    // missing store-bound orders) starts and stays in flight.
    await resolveQuery(queriesFor("order_sources")[0], { data: [{ id: "src1" }], error: null });
    await waitFor(() => expect(queriesFor("orders")).toHaveLength(1));
    const runA = queriesFor("orders")[0];
    expect(runA.builder.or).not.toHaveBeenCalled(); // single-scope: .in(), not .or()
    expect(runA.builder.in).toHaveBeenCalledWith("order_source_id", ["src1"]);

    // Store scope lands second → run B (both scopes: full row set) starts.
    storesMock.mockReturnValue([{ id: "s1", name: "Store One" }]);
    rerender();
    await waitFor(() => expect(queriesFor("orders")).toHaveLength(2));
    const runB = queriesFor("orders")[1];
    expect(runB.builder.or).toHaveBeenCalledTimes(1); // both scopes present

    // The NEWER run answers first: the full list (store-bound + source-only rows).
    await resolveQuery(runB, { data: [row("o1"), row("o2")], error: null });
    await waitFor(() =>
      expect(result.current.orders.map((o) => o.id)).toEqual(["o1", "o2"]),
    );

    // The OLDER, scope-partial run answers LAST — the original bug: its
    // response used to overwrite the full list (last response wins) and
    // nothing refetched, leaving "new"/"pre-order" rows missing forever.
    await resolveQuery(runA, { data: [row("o2")], error: null });

    // Stale run must be discarded: full list intact.
    expect(result.current.orders.map((o) => o.id)).toEqual(["o1", "o2"]);
  });

  it("surfaces a failed fetch as loadError and keeps the previous rows on screen", async () => {
    storesMock.mockReturnValue([{ id: "s1", name: "Store One" }]);
    const { result } = renderHook(() => useOrdersData());

    await waitFor(() => expect(queriesFor("orders")).toHaveLength(1));
    await resolveQuery(queriesFor("orders")[0], { data: [row("o1")], error: null });
    await waitFor(() => expect(result.current.orders).toHaveLength(1));

    // Resolve the order-source scope so its arrival doesn't add runs later.
    await waitFor(() => expect(queriesFor("order_sources")).toHaveLength(1));
    await resolveQuery(queriesFor("order_sources")[0], { data: [], error: null });
    await waitFor(() => expect(queriesFor("orders").length).toBeGreaterThanOrEqual(2));
    const failing = queriesFor("orders").at(-1)!;

    // Original bug: the error was swallowed (`const { data } = await ...`)
    // and the list rendered as empty/stale with no feedback and no retry.
    await resolveQuery(failing, { data: null, error: { message: "boom" } });

    await waitFor(() => expect(result.current.loadError).toBe("boom"));
    // Previous rows survive — stale-but-real beats a silently blank page.
    expect(result.current.orders.map((o) => o.id)).toEqual(["o1"]);
    expect(result.current.loading).toBe(false);
  });

  it("pages past the 1000-row PostgREST cap instead of silently truncating", async () => {
    storesMock.mockReturnValue([{ id: "s1", name: "Store One" }]);
    const { result } = renderHook(() => useOrdersData());

    await waitFor(() => expect(queriesFor("orders")).toHaveLength(1));
    // Full first page = exactly the server cap → fetchAllRows must ask again.
    const page1 = Array.from({ length: 1000 }, (_, i) => row(`o${i}`));
    await resolveQuery(queriesFor("orders")[0], { data: page1, error: null });
    await waitFor(() => expect(queriesFor("orders")).toHaveLength(2));
    const secondPageQuery = queriesFor("orders")[1];
    // Deterministic page window + tie-break order (see useOrdersData).
    expect(secondPageQuery.builder.range).toHaveBeenCalledWith(1000, 1999);

    await resolveQuery(secondPageQuery, { data: [row("o1000"), row("o1001")], error: null });
    await waitFor(() => expect(result.current.orders).toHaveLength(1002));
  });

  it("chunks the product_categories lookup so request URLs stay bounded, and the map is complete", async () => {
    storesMock.mockReturnValue([{ id: "s1", name: "Store One" }]);
    const { result } = renderHook(() => useOrdersData());

    await waitFor(() => expect(queriesFor("orders")).toHaveLength(1));
    // 250 distinct products across the rows → 150 + 100 id chunks, fetched
    // concurrently so lookup latency is the slowest chunk, not their sum.
    const rows = Array.from({ length: 250 }, (_, i) => row(`o${i}`, `p${i}`));
    await resolveQuery(queriesFor("orders")[0], { data: rows, error: null });

    await waitFor(() => expect(queriesFor("product_categories")).toHaveLength(2));
    const chunk1 = queriesFor("product_categories")[0];
    const chunk2 = queriesFor("product_categories")[1];
    const ids1 = chunk1.builder.in.mock.calls[0][1] as string[];
    expect(ids1).toHaveLength(150);
    const ids2 = chunk2.builder.in.mock.calls[0][1] as string[];
    expect(ids2).toHaveLength(100);
    await act(async () => {
      chunk1.resolve({
        data: ids1.map((p) => ({ product_id: p, category_id: "c-pre" })),
        error: null,
      });
      chunk2.resolve({
        data: ids2.map((p) => ({ product_id: p, category_id: "c-pre" })),
        error: null,
      });
      await new Promise((r) => setTimeout(r, 0));
    });

    // Every order gets a complete category set (feeds "new"/"pre_order" tabs).
    await waitFor(() => expect(result.current.orderCategoryMap.size).toBe(250));
    for (let i = 0; i < 250; i++) {
      expect(result.current.orderCategoryMap.get(`o${i}`)).toEqual(new Set(["c-pre"]));
    }
  });

  it("surfaces order-source scope failures and retry re-runs the scope fetch", async () => {
    storesMock.mockReturnValue([{ id: "s1", name: "Store One" }]);
    const { result } = renderHook(() => useOrdersData());

    // A failed scope fetch used to be swallowed → the query silently ran
    // store-scoped-only and lost order-source-only ("new"/"pre-order") rows.
    await waitFor(() => expect(queriesFor("order_sources")).toHaveLength(1));
    await resolveQuery(queriesFor("order_sources")[0], {
      data: null,
      error: { message: "scope boom" },
    });
    await waitFor(() => expect(result.current.orderSourceError).toBe("scope boom"));

    await resolveQuery(queriesFor("orders")[0], { data: [row("o1")], error: null });
    await waitFor(() => expect(result.current.orders).toHaveLength(1));

    // Retry must fix the SCOPE, not just re-run the same under-scoped query.
    act(() => result.current.retryLoad());
    await waitFor(() => expect(queriesFor("order_sources")).toHaveLength(2));
    await resolveQuery(queriesFor("order_sources")[1], {
      data: [{ id: "src1" }],
      error: null,
    });
    await waitFor(() => expect(result.current.orderSourceError).toBeNull());

    // …and the scope change triggers a fresh, properly-scoped row load.
    await waitFor(() => expect(queriesFor("orders").length).toBeGreaterThanOrEqual(3));
    const latest = queriesFor("orders").at(-1)!;
    expect(latest.builder.or).toHaveBeenCalledTimes(1);
    await resolveQuery(latest, { data: [row("o1"), row("o2")], error: null });
    await waitFor(() => expect(result.current.orders).toHaveLength(2));
  });
});
