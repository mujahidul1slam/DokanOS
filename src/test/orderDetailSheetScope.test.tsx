import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Hybrid tenancy (issue #16): the order detail sheet.
//
// The sheet is the second way into an order's rows. Its parent read must carry
// the tenant predicate, and its CHILD reads (order_items, order_payments,
// order_timeline, order_item_measurements, courier_shipments) must only ever be
// reached for an order that is inside the active business's stores — otherwise
// a foreign order id (deep link, stale state) would reintroduce that business's
// child rows. The product picker is an operational read too.
// Precedent for the mocked client: src/test/dashboardTenantScope.test.tsx.

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
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: vi.fn() }));

import { supabase } from "@/integrations/supabase/client";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import { usePermissions } from "@/hooks/usePermissions";
import OrderDetailSheet from "@/components/orders/OrderDetailSheet";

const fromMock = supabase.from as unknown as Mock;
const contextMock = useBusinessContext as unknown as Mock;
const permissionsMock = usePermissions as unknown as Mock;

const BIZ_ONE_STORES = ["s1", "s2"];
const BIZ_TWO_STORES = ["s9"];
const CHILD_TABLES = [
  "order_items",
  "order_payments",
  "order_timeline",
  "order_item_measurements",
  "courier_shipments",
];

type Query = { table: string; calls: Array<{ method: string; args: unknown[] }>; single: boolean };

let queries: Query[] = [];
let rows: Record<string, unknown[]> = {};
let orderById: Record<string, unknown> = {};
let since = 0;

const mark = () => {
  since = fromMock.mock.calls.length;
  queries = [];
};

const queriesFor = (table: string) => queries.filter((q) => q.table === table);

const argsFor = (table: string, method: string) =>
  queriesFor(table).flatMap((q) => q.calls.filter((c) => c.method === method).map((c) => c.args));

const resultFor = (q: Query) => {
  const idEq = q.calls.find((c) => c.method === "eq" && c.args[0] === "id");
  if (q.table === "orders" && idEq) {
    return { data: orderById[String(idEq.args[1])] ?? null, error: null, count: 0 };
  }
  const data = rows[q.table] ?? [];
  return { data: q.single ? data[0] ?? null : data, error: null, count: data.length };
};

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

let currentContext: Record<string, unknown> = {};

const setActiveBusiness = (id: string | null, storeIds: string[]) => {
  currentContext = {
    active: id ? { id, name: "Business", currency: "BDT" } : null,
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

const detailOrder = (over: Record<string, unknown> = {}) => ({
  id: "o1",
  order_number: "1001",
  status: "processing",
  payment_status: "unpaid",
  payment_method: "cod",
  source: "online",
  subtotal: 500,
  discount: 0,
  shipping_cost: 0,
  total: 500,
  tax_amount: 0,
  amount_to_collect: 500,
  notes: null,
  consignment_id: null,
  tracking_status: null,
  created_at: "2026-10-26T02:00:00.000Z",
  customer_name: "Alice",
  customer_phone: "01700000000",
  customer_address: "Road 1",
  customer_email: "alice@example.com",
  customer_city: "Dhaka",
  fulfillment_type: "delivery",
  woo_order_id: null,
  store_id: "s1",
  storefront_id: null,
  stock_restored_at: null,
  stores: { url: null, name: "Store One" },
  ...over,
});

const renderSheet = () =>
  render(<OrderDetailSheet orderId="o1" open onOpenChange={vi.fn()} />);

describe("OrderDetailSheet reads are scoped to the active business's stores", () => {
  beforeEach(() => {
    fromMock.mockReset();
    permissionsMock.mockReturnValue({ can: () => true });
    currentContext = {};
    contextMock.mockImplementation(() => currentContext);
    rows = {};
    orderById = {};

    rows.order_items = [
      {
        id: "i1",
        product_name: "Shirt",
        quantity: 1,
        unit_price: 500,
        line_total: 500,
        product_id: "p1",
        products: { name: "Shirt" },
      },
    ];
    rows.order_payments = [
      { id: "pay1", method: "bkash", amount: 200, trx_id: null, notes: null, created_at: "2026-10-26T02:00:00.000Z" },
    ];
    rows.order_timeline = [
      { id: "t1", event: "created", description: "Order created", created_at: "2026-10-26T02:00:00.000Z", metadata: null },
    ];
    rows.order_item_measurements = [];
    rows.courier_shipments = [];
    rows.stores = [
      { id: "s1", name: "Store One" },
      { id: "s2", name: "Store Two" },
    ];
    rows.products = [{ id: "p1", name: "Shirt", sku: "S-1", price: 500 }];
    orderById = { o1: detailOrder() };
    setActiveBusiness("b1", BIZ_ONE_STORES);
    installClient();
    mark();
  });

  afterEach(() => {
    cleanup();
  });

  it("reads the order through the tenant predicate, then bounds every child read to it", async () => {
    renderSheet();

    await waitFor(() => expect(screen.getAllByText("#1001").length).toBeGreaterThan(0));

    // Exactly one parent read, and it carries the scope.
    expect(queriesFor("orders")).toHaveLength(1);
    expect(argsFor("orders", "eq")).toEqual([["id", "o1"]]);
    expect(argsFor("orders", "in")).toEqual([["store_id", BIZ_ONE_STORES]]);

    // Child rows are reachable only through that verified order.
    for (const table of CHILD_TABLES) {
      expect(argsFor(table, "eq")).toEqual([["order_id", "o1"]]);
    }

    // The product picker is scoped to the business's stores as well.
    expect(argsFor("products", "in")).toEqual([["store_id", BIZ_ONE_STORES]]);
  });

  it("never reaches a foreign order's child rows", async () => {
    // The parent read is scoped, so the database returns nothing for an order
    // that lives in another business. What the payload must NOT silently do is
    // keep going: no child read may be issued for an unverified order.
    orderById = { o1: detailOrder({ store_id: "s9", stores: { url: null, name: "Foreign Store" } }) };

    renderSheet();

    await waitFor(() => expect(queriesFor("orders")).toHaveLength(1));
    expect(argsFor("orders", "in")).toEqual([["store_id", BIZ_ONE_STORES]]);
    for (const table of CHILD_TABLES) {
      expect(queriesFor(table)).toEqual([]);
    }
    expect(screen.queryAllByText("#1001")).toEqual([]);
  });

  it("fails closed when the active business has no mapped stores: no read at all", async () => {
    setActiveBusiness("b1", []);
    mark();

    renderSheet();

    await waitFor(() => expect(fromMock.mock.calls.length).toBe(since));
    expect(screen.queryAllByText("#1001")).toEqual([]);
  });

  it("re-reads with the new business's stores when the business is switched", async () => {
    const view = renderSheet();
    await waitFor(() => expect(queriesFor("orders")).toHaveLength(1));

    mark();
    rows.stores = [{ id: "s9", name: "Store Nine" }];
    setActiveBusiness("b2", BIZ_TWO_STORES);
    view.rerender(<OrderDetailSheet orderId="o1" open onOpenChange={vi.fn()} />);

    await waitFor(() => expect(argsFor("orders", "in")).toContainEqual(["store_id", BIZ_TWO_STORES]));
    expect(argsFor("orders", "in")).not.toContainEqual(["store_id", BIZ_ONE_STORES]);
  });

  it("scopes the exchange detail read as well", async () => {
    orderById = { o1: detailOrder({ status: "delivered" }) };
    renderSheet();
    await waitFor(() => expect(screen.getAllByText("#1001").length).toBeGreaterThan(0));

    mark();
    fireEvent.click(screen.getByText("Create Exchange"));

    await waitFor(() => expect(queriesFor("orders")).toHaveLength(1));
    expect(argsFor("orders", "eq")).toEqual([["id", "o1"]]);
    expect(argsFor("orders", "in")).toEqual([["store_id", BIZ_ONE_STORES]]);
  });
});
