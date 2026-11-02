import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

// Hybrid tenancy (issue #16): EVERY operational query the Dashboard issues must
// be scoped to the active business's store ids, and must fail closed (no query
// at all) when that scope is empty. The Supabase client is module-mocked, so the
// assertions below are on the exact predicates the hook puts on the wire.
//
// Each case measures only the queries IT issued: `mark()` snapshots the mock's
// call history, and the assertions are taken over the calls made afterwards.

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn() },
}));

vi.mock("@/lib/stockSettings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stockSettings")>();
  return { ...actual, useGlobalStockEnabled: vi.fn(() => true) };
});

import { supabase } from "@/integrations/supabase/client";
import { useGlobalStockEnabled } from "@/lib/stockSettings";
import { useDashboardData } from "@/hooks/useDashboardData";

const fromMock = supabase.from as unknown as Mock;
const stockEnabledMock = useGlobalStockEnabled as unknown as Mock;

const BIZ_ONE_STORES = ["s1", "s2"];
const BIZ_TWO_STORES = ["s9"];
const NO_SCOPE: string[] = [];

type Query = {
  table: string;
  calls: Array<{ method: string; args: unknown[] }>;
};

/** Calls made since the last `mark()`, plus the queries they created. */
let since = 0;
let queries: Query[] = [];
let counts: Record<string, number> = {};
let rows: Record<string, unknown[]> = {};

/** Start measuring: ignore everything the mock recorded before this point. */
const mark = () => {
  since = fromMock.mock.calls.length;
  queries = [];
};

/** When deferred mode is on, each query's await waits for an explicit release. */
type Pending = { resolve: (value: Record<string, unknown>) => void };
let deferred: Pending[] = [];
let deferredMode = false;
/** Result payload the next released query resolves with. */
let nextResult: Record<string, unknown> = { data: null, error: null, count: 0 };

const queriesFor = (table: string) => queries.filter((q) => q.table === table);

/** The arguments of every call to `method` across the queries for `table`. */
const argsFor = (table: string, method: string) =>
  queriesFor(table).flatMap((q) => q.calls.filter((c) => c.method === method).map((c) => c.args));

/** Chainable query-builder mock that records every predicate applied to it. */
const makeBuilder = (query: Query, result: Record<string, unknown>) => {
  const b: Record<string, unknown> = {};
  for (const method of [
    "select",
    "order",
    "in",
    "eq",
    "neq",
    "gte",
    "lte",
    "lt",
    "gt",
    "is",
    "or",
    "maybeSingle",
  ]) {
    b[method] = vi.fn((...args: unknown[]) => {
      query.calls.push({ method, args });
      return b;
    });
  }
  b.then = (onFulfilled: (value: Record<string, unknown>) => unknown) =>
    Promise.resolve(result).then(onFulfilled);
  return b;
};

/** A builder whose await is resolved later, so responses can be reordered. */
const makeDeferredBuilder = (query: Query, result: Record<string, unknown>) => {
  const b = makeBuilder(query, result);
  b.then = (onFulfilled: (value: Record<string, unknown>) => unknown) =>
    new Promise<Record<string, unknown>>((resolve) => {
      deferred.push({ resolve });
    }).then(onFulfilled);
  return b;
};

/** Resolves one pending query with `nextResult` and lets the load continue. */
const settle = async (index: number) => {
  const { resolve } = deferred[index];
  await act(async () => {
    resolve(nextResult);
    // Let every continuation of the load run (order_items, stock counts).
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
};

/**
 * Runs the sweep starting at `from` to completion, releasing the further queries
 * that sweep issues (order_items, then the stock counts) as it reaches them,
 * while every query OUTSIDE the sweep stays pending. `pendingLoads` returning to
 * `pendingElsewhere` (the unfinished loads belonging to the other business)
 * proves this sweep committed.
 */
const releaseSweep = async (
  result: { current: { pendingLoads: number } },
  from: number,
  pendingElsewhere: number,
) => {
  let next = from;
  while (next < deferred.length || result.current.pendingLoads > pendingElsewhere) {
    if (next < deferred.length) {
      // eslint-disable-next-line no-await-in-loop
      await settle(next);
      next += 1;
    } else {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }
};

/**
 * Waits for a COMPLETE scope sweep: the hook's load spans several round trips,
 * so `loading === false` alone can still race the last product queries.
 */
const sweepDone = (result: { current: { loading: boolean; pendingLoads: number } }) =>
  waitFor(() => expect([result.current.loading, result.current.pendingLoads]).toEqual([false, 0]));

beforeEach(() => {
  fromMock.mockReset();
  stockEnabledMock.mockReturnValue(true);
  counts = {};
  rows = {};
  deferred = [];
  deferredMode = false;
  nextResult = { data: null, error: null, count: 0 };
  fromMock.mockImplementation((table: string) => {
    const query: Query = { table, calls: [] };
    queries.push(query);
    const result = { data: rows[table] ?? [], error: null, count: counts[table] ?? 0 };
    return deferredMode ? makeDeferredBuilder(query, result) : makeBuilder(query, result);
  });
  mark();
});

afterEach(() => {
  cleanup();
});

const ORDER_ROW = {
  id: "o1",
  order_number: "1001",
  total: 500,
  subtotal: 500,
  discount: 0,
  shipping_cost: 0,
  status: "processing",
  source: "online",
  payment_status: "paid",
  payment_method: "bkash",
  created_at: "2026-10-26T02:00:00.000Z",
  customer_name: "A",
  customer_id: "c1",
  consignment_id: null,
  store_id: "s1",
};

describe("useDashboardData scopes every operational query to the active business", () => {
  it("applies the tenant predicate to all orders and products reads on the 'all stores' path", async () => {
    counts = { orders: 4, products: 7 };
    rows = { orders: [ORDER_ROW], products: [{ id: "p1" }], order_items: [] };

    const { result } = renderHook(() => useDashboardData("today", undefined, "all", BIZ_ONE_STORES));
    await sweepDone(result);

    // Orders: current period, previous period, and the total count, all scoped.
    expect(queriesFor("orders")).toHaveLength(3);
    expect(argsFor("orders", "in")).toEqual([
      ["store_id", BIZ_ONE_STORES],
      ["store_id", BIZ_ONE_STORES],
      ["store_id", BIZ_ONE_STORES],
    ]);
    // The unscoped store filter that caused the leak is gone.
    expect(argsFor("orders", "eq").some((args) => args[0] === "store_id")).toBe(false);

    // Products: the full row read, the total count, the low-stock count and the
    // out-of-stock count, all scoped, none of them unscoped.
    expect(queriesFor("products")).toHaveLength(4);
    expect(argsFor("products", "in")).toEqual([
      ["store_id", BIZ_ONE_STORES],
      ["store_id", BIZ_ONE_STORES],
      ["store_id", BIZ_ONE_STORES],
      ["store_id", BIZ_ONE_STORES],
    ]);
    // Order items are bounded by the already-scoped order ids.
    expect(argsFor("order_items", "in")).toEqual([["order_id", ["o1"]]]);
    // The business's own numbers are what surfaces.
    expect(result.current.allOrdersCount).toBe(4);
    expect(result.current.productsCount).toBe(7);
  });

  it("fails closed with an empty scope: zero queries and zeroed KPIs", async () => {
    counts = { orders: 4, products: 7 };
    rows = { orders: [ORDER_ROW], products: [{ id: "p1" }] };

    const { result } = renderHook(() => useDashboardData("today", undefined, "all", NO_SCOPE));
    await sweepDone(result);

    expect(fromMock.mock.calls.length).toBe(since);
    expect(result.current.orders).toEqual([]);
    expect(result.current.products).toEqual([]);
    expect(result.current.allOrdersCount).toBe(0);
    expect(result.current.productsCount).toBe(0);
    expect(result.current.lowStockCount).toBe(0);
    expect(result.current.outOfStockCount).toBe(0);
    expect(result.current.cur.revenue).toBe(0);
  });

  it("re-runs scoped when the active business changes", async () => {
    rows = { orders: [ORDER_ROW], products: [{ id: "p1" }] };
    const { result, rerender } = renderHook(
      ({ scope }: { scope: string[] }) => useDashboardData("today", undefined, "all", scope),
      { initialProps: { scope: BIZ_ONE_STORES } },
    );
    await sweepDone(result);

    mark(); // measure the switch only
    rerender({ scope: BIZ_TWO_STORES });
    await sweepDone(result);

    const scoped = queries.flatMap((q) =>
      q.calls.filter((c) => c.method === "in" && c.args[0] === "store_id").map((c) => c.args[1]),
    );
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.every((ids) => JSON.stringify(ids) === JSON.stringify(BIZ_TWO_STORES))).toBe(true);
    expect(scoped).not.toContainEqual(BIZ_ONE_STORES);
  });

  it("keeps the tenant predicate when a single store is selected", async () => {
    rows = { orders: [ORDER_ROW], products: [] };

    const { result } = renderHook(() => useDashboardData("today", undefined, "s2", BIZ_ONE_STORES));
    await sweepDone(result);

    expect(argsFor("orders", "in")).toEqual([
      ["store_id", ["s2"]],
      ["store_id", ["s2"]],
      ["store_id", ["s2"]],
    ]);
  });

  it("fails closed when a store filter is selected but the business scope is empty", async () => {
    const { result } = renderHook(() => useDashboardData("today", undefined, "s2", NO_SCOPE));
    await sweepDone(result);

    expect(fromMock.mock.calls.length).toBe(since);
    expect(result.current.products).toEqual([]);
  });

  it("fails closed when the selected store is not one of the active business's stores", async () => {
    // A store filter carried over from the previous business must not become a
    // scope of its own: only stores inside the active business's scope may query.
    const { result } = renderHook(() => useDashboardData("today", undefined, "s7", BIZ_ONE_STORES));
    await sweepDone(result);

    expect(fromMock.mock.calls.length).toBe(since);
    expect(result.current.orders).toEqual([]);
  });

  it("scopes the POS source filter to the business's stores as well", async () => {
    rows = { orders: [ORDER_ROW], products: [] };

    const { result } = renderHook(() => useDashboardData("today", undefined, "pos", BIZ_ONE_STORES));
    await sweepDone(result);

    expect(argsFor("orders", "eq")).toContainEqual(["source", "pos"]);
    expect(argsFor("orders", "in")).toEqual([
      ["store_id", BIZ_ONE_STORES],
      ["store_id", BIZ_ONE_STORES],
      ["store_id", BIZ_ONE_STORES],
    ]);
    // No query is left without a tenant predicate.
    expect(argsFor("products", "in")).toHaveLength(4);
  });

  it("ignores a late response from the previous business's scope", async () => {
    rows = { orders: [ORDER_ROW], products: [] };
    deferredMode = true;

    const { result, rerender } = renderHook(
      ({ scope }: { scope: string[] }) => useDashboardData("today", undefined, "all", scope),
      { initialProps: { scope: BIZ_ONE_STORES } },
    );
    await waitFor(() => expect(deferred.length).toBe(5)); // 3 order + 2 product round trips
    const firstBusinessCount = deferred.length;

    // Switch business while the first business's load is still in flight: its
    // five queries are never released, so its responses stay pending.
    rerender({ scope: BIZ_TWO_STORES });
    await waitFor(() => expect(deferred.length).toBeGreaterThan(firstBusinessCount));

    // The NEW business's responses arrive first and commit.
    nextResult = { data: [ORDER_ROW], error: null, count: 1 };
    await releaseSweep(result, firstBusinessCount, 1); // the old load stays outstanding
    expect(result.current.orders).toHaveLength(1);
    expect(result.current.allOrdersCount).toBe(1);

    // The OLD business's stale responses land afterwards, with different data.
    nextResult = { data: [], error: null, count: 9 };
    for (const i of [0, 1, 2, 3, 4]) {
      // eslint-disable-next-line no-await-in-loop
      await settle(i);
    }

    // The stale business's empty payload must NOT repaint the new business's KPIs.
    expect(result.current.orders).toHaveLength(1);
    expect(result.current.allOrdersCount).toBe(1);
  });
});
