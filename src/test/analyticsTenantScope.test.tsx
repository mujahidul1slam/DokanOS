import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Hybrid tenancy (issue #16): the Analytics surface.
//
// Analytics is the one acceptance-criterion page ("Switching business changes
// Dashboard KPIs on All stores, /orders, /products and /analytics") whose
// client-side scope had no dedicated suite: the orders reads (current period,
// previous period, all-history customers), the pos_returns read and the
// products read must all carry the ACTIVE business's store ids, must fail
// closed when that scope is empty, and must re-run when the business is
// switched. order_items is intentionally NOT store-scoped: it is bounded by
// the ids of orders that were already read inside the scope (transitive).
// The Supabase client and the context hook are module-mocked (precedent:
// src/test/ordersTenantScope.test.tsx, src/test/dashboardTenantScope.test.tsx),
// so the assertions below are on the exact predicates the page puts on the wire.

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(async () => ({ data: null, error: null })),
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "u1", email: "owner@example.com" } } })),
    },
  },
}));

vi.mock("@/hooks/useBusinessContext", () => ({ useBusinessContext: vi.fn() }));
vi.mock("@/lib/stockSettings", () => ({
  useGlobalStockEnabled: vi.fn(() => false),
  getEffectiveStock: vi.fn((product: { stock_quantity?: number | null }) => product?.stock_quantity ?? 0),
}));

import { supabase } from "@/integrations/supabase/client";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import Analytics from "@/pages/Analytics";

const fromMock = supabase.from as unknown as Mock;
const contextMock = useBusinessContext as unknown as Mock;

const BIZ_ONE_STORES = ["s1", "s2"];
const BIZ_TWO_STORES = ["s9"];

type Query = { table: string; calls: Array<{ method: string; args: unknown[] }>; single: boolean };

let queries: Query[] = [];
/** Rows per table, as the database would hand them to this business. */
let rows: Record<string, unknown[]> = {};

/** Start measuring: ignore everything the mock recorded before this point. */
const mark = () => {
  queries = [];
};

const queriesFor = (table: string) => queries.filter((q) => q.table === table);

/** The tenant predicate of every read of `table`, or null when one has none. */
const readScopes = (table: string) =>
  queriesFor(table).map((q) => {
    const scoped = q.calls.filter((c) => c.method === "in" && c.args[0] === "store_id");
    return scoped.length === 1 ? (scoped[0].args[1] as string[]) : null;
  });

const resultFor = (q: Query) => {
  const data = rows[q.table] ?? [];
  return { data: q.single ? data[0] ?? null : data, error: null, count: data.length };
};

/** Chainable query-builder mock that records every predicate applied to it. */
const makeBuilder = (query: Query) => {
  const b: Record<string, unknown> = {};
  for (const method of [
    "select", "order", "in", "eq", "neq", "is", "not", "or", "gte", "lte", "gt", "lt",
    "limit", "range", "update", "insert", "delete", "upsert",
  ]) {
    b[method] = vi.fn((...args: unknown[]) => {
      query.calls.push({ method, args });
      return b;
    });
  }
  const single = vi.fn(() => {
    query.single = true;
    query.calls.push({ method: "single", args: [] });
    return b;
  });
  b.single = single;
  b.maybeSingle = single;
  b.then = (onFulfilled: (value: unknown) => unknown) =>
    Promise.resolve(resultFor(query)).then(onFulfilled);
  return b;
};

const installClient = () => {
  fromMock.mockImplementation((table: string) => {
    const query: Query = { table, calls: [], single: false };
    queries.push(query);
    return makeBuilder(query);
  });
};

/** The context value the page sees; a "switch" swaps it like the provider. */
let currentContext: Record<string, unknown> = {};

const setActiveBusiness = (id: string | null, storeIds: string[]) => {
  currentContext = {
    active: id ? { id, name: "Business", logo_url: null, currency: "USD" } : null,
    businesses: [],
    brands: storeIds.map((woo_store_id) => ({ woo_store_id })),
    brandStores: [],
    activeBrand: null,
    myRole: "owner",
    rolesByBusiness: {},
    loading: false,
    error: null,
    contextReady: true,
    setActive: vi.fn(),
    setActiveBrand: vi.fn(),
    refresh: vi.fn(),
    sellingPointsCount: 0,
    onboardingCompletedAt: null,
  };
};

const renderAnalytics = () =>
  render(
    <MemoryRouter initialEntries={["/analytics"]}>
      <Analytics />
    </MemoryRouter>,
  );

const orderRow = (over: Record<string, unknown> = {}) => ({
  id: "o1",
  total: 500,
  subtotal: 480,
  discount: 20,
  shipping_cost: 0,
  tax_amount: 0,
  status: "completed",
  source: "online",
  payment_status: "paid",
  created_at: new Date().toISOString(),
  customer_id: "c1",
  customer_name: "Alice",
  customer_city: "Dhaka",
  consignment_id: null,
  salesperson_name: null,
  store_id: "s1",
  deleted_at: null,
  ...over,
});

describe("Analytics reads are scoped to the active business's stores", () => {
  beforeEach(() => {
    fromMock.mockReset();
    currentContext = {};
    contextMock.mockImplementation(() => currentContext);
    rows = {};
    installClient();

    rows.stores = [
      { id: "s1", name: "Store One" },
      { id: "s2", name: "Store Two" },
    ];
    rows.orders = [orderRow()];
    rows.products = [
      { id: "p1", name: "Alpha Tee", price: 15, cost_price: 8, stock_quantity: 50, stock_status: "instock", manage_stock: true, sales_count: 3, updated_at: new Date().toISOString() },
    ];
    rows.pos_returns = [{ refund_amount: 25, created_at: new Date().toISOString() }];
    rows.order_items = [
      { product_name: "Alpha Tee", quantity: 2, unit_price: 15, line_total: 30, product_id: "p1", order_id: "o1" },
    ];
    setActiveBusiness("b1", BIZ_ONE_STORES);
  });

  afterEach(() => {
    cleanup();
  });

  it("scopes every orders, pos_returns and products read it issues", async () => {
    renderAnalytics();
    // Three orders reads: current period, previous period, all-history customers.
    await waitFor(() => expect(queriesFor("orders").length).toBe(3));

    const orderScopes = readScopes("orders");
    expect(orderScopes.length).toBe(3);
    for (const scope of orderScopes) expect(scope).toEqual(BIZ_ONE_STORES);

    expect(readScopes("pos_returns")).toEqual([BIZ_ONE_STORES]);
    expect(readScopes("products")).toEqual([BIZ_ONE_STORES]);
  });

  it("bounds order_items by the ids of orders read inside the scope", async () => {
    renderAnalytics();
    await waitFor(() => expect(queriesFor("order_items").length).toBeGreaterThan(0));

    // The page's own read keys items by the ids that came back from the
    // scoped current-period orders read (child sheets may read order_items
    // with other predicates, so match on the order_id `in` specifically).
    const scopedItemsRead = queriesFor("order_items").find((q) =>
      q.calls.some((c) => c.method === "in" && c.args[0] === "order_id"),
    );
    expect(scopedItemsRead).toBeDefined();
    const orderIds = scopedItemsRead!.calls.find((c) => c.method === "in" && c.args[0] === "order_id");
    // Only ids that came back from the scoped current-period orders read.
    expect(orderIds!.args[1]).toEqual(rows.orders!.map((o) => (o as { id: string }).id));
  });

  it("fails closed with zero operational queries when the scope is empty", async () => {
    setActiveBusiness("b1", []);
    mark();
    renderAnalytics();

    // The page settles to its zeroed render (stat card titles are static).
    await waitFor(() => expect(screen.queryAllByText("Revenue").length).toBeGreaterThan(0));
    expect(queriesFor("orders").length).toBe(0);
    expect(queriesFor("products").length).toBe(0);
    expect(queriesFor("pos_returns").length).toBe(0);
    expect(queriesFor("order_items").length).toBe(0);
  });

  it("re-runs the scoped reads with the new business after a switch", async () => {
    const view = renderAnalytics();
    await waitFor(() => expect(queriesFor("orders").length).toBe(3));
    mark();

    // The seam re-derives the scope from the (swapped) context and re-reads
    // the new business's stores, so the mocked rows swap with the context.
    rows.stores = [{ id: "s9", name: "Store Nine" }];
    setActiveBusiness("b2", BIZ_TWO_STORES);
    view.rerender(
      <MemoryRouter initialEntries={["/analytics"]}>
        <Analytics />
      </MemoryRouter>,
    );

    await waitFor(() => {
      const scopes = readScopes("orders").filter(Boolean);
      expect(scopes.length).toBeGreaterThan(0);
      expect(scopes[scopes.length - 1]).toEqual(BIZ_TWO_STORES);
    });
    // Every orders read re-issued after the switch carries the new scope.
    for (const scope of readScopes("orders")) {
      if (scope !== null) expect(scope).toEqual(BIZ_TWO_STORES);
    }
  });
});
