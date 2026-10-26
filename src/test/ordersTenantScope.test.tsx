import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Hybrid tenancy (issue #16): the Orders surface.
//
// Every operational read behind the page — the orders list, the store
// selector, the category selector, the product_categories mapping and the
// single-order reprint — must carry the ACTIVE business's store ids, must fail
// closed when that scope is empty (or when the store filter names a store of
// another business), and must re-run when the business is switched. The
// Supabase client, the context hook and the permission hook are module-mocked
// (precedent: src/test/dashboardTenantScope.test.tsx,
// src/test/appSidebarCategoryScope.test.tsx), so the assertions below are on
// the exact predicates the page puts on the wire.

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
vi.mock("@/components/pos/InvoicePrint", () => ({ printInvoice: vi.fn() }));

import { supabase } from "@/integrations/supabase/client";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import { usePermissions } from "@/hooks/usePermissions";
import { printInvoice } from "@/components/pos/InvoicePrint";
import Orders from "@/pages/Orders";

const fromMock = supabase.from as unknown as Mock;
const contextMock = useBusinessContext as unknown as Mock;
const permissionsMock = usePermissions as unknown as Mock;
const printInvoiceMock = printInvoice as unknown as Mock;

const BIZ_ONE_STORES = ["s1", "s2"];
const BIZ_TWO_STORES = ["s9"];

type Query = { table: string; calls: Array<{ method: string; args: unknown[] }>; single: boolean };

let queries: Query[] = [];
/** Rows per table, as the database would hand them to this business. */
let rows: Record<string, unknown[]> = {};
/** `orders` reads filtered by primary key resolve from here (the reprint path). */
let ordersById: Record<string, unknown> = {};

/** Start measuring: ignore everything the mock recorded before this point. */
const mark = () => {
  queries = [];
};

const queriesFor = (table: string) => queries.filter((q) => q.table === table);

const argsFor = (table: string, method: string) =>
  queriesFor(table).flatMap((q) => q.calls.filter((c) => c.method === method).map((c) => c.args));

/** The tenant-scoped tables behind this surface. */
const OPERATIONAL_TABLES = [
  "orders",
  "stores",
  "categories",
  "products",
  "product_categories",
  "order_items",
  "order_payments",
];

/** Every operational read recorded since the last `mark()`. */
const operationalQueries = () => queries.filter((q) => OPERATIONAL_TABLES.includes(q.table));

/** The tenant predicate of every orders read, or null when one has none. */
const ordersReadScopes = () =>
  queriesFor("orders").map((q) => {
    const scoped = q.calls.filter((c) => c.method === "in" && c.args[0] === "store_id");
    return scoped.length === 1 ? scoped[0].args[1] : null;
  });

const resultFor = (q: Query) => {
  const idEq = q.calls.find((c) => c.method === "eq" && c.args[0] === "id");
  if (q.table === "orders" && idEq) {
    const row = ordersById[String(idEq.args[1])] ?? null;
    return { data: row, error: null, count: row ? 1 : 0 };
  }
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
    active: id ? { id, name: "Business", logo_url: null } : null,
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

const renderOrders = (entry = "/orders") =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Orders />
    </MemoryRouter>,
  );

const orderRow = (over: Record<string, unknown> = {}) => ({
  id: "o1",
  order_number: "1001",
  total: 500,
  status: "processing",
  source: "online",
  payment_method: "bkash",
  payment_status: "paid",
  consignment_id: null,
  tracking_status: null,
  fulfillment_type: "delivery",
  created_at: "2026-10-26T02:00:00.000Z",
  deleted_at: null,
  store_id: "s1",
  woo_order_id: null,
  customer_id: null,
  amount_to_collect: 0,
  pathao_recipient_city: null,
  pathao_recipient_zone: null,
  pathao_recipient_area: null,
  pathao_store_id: null,
  item_weight: null,
  special_instruction: null,
  customer_name: "Alice",
  customer_phone: "01700000000",
  customer_address: "Road 1",
  customer_city: "Dhaka",
  customer_email: "alice@example.com",
  pickup_slip_printed_at: null,
  measurement_slip_printed_at: null,
  stores: { name: "Store One" },
  order_items: [
    { id: "i1", product_id: "p1", product_name: "Shirt", quantity: 1, products: { stock_status: "instock" } },
  ],
  ...over,
});

/** An order belonging to ANOTHER business (its store is not in the scope). */
const foreignOrderRow = () =>
  orderRow({
    id: "o9",
    order_number: "9001",
    store_id: "s9",
    stores: { name: "Foreign Store" },
    order_items: [
      { id: "i9", product_id: "p9", product_name: "Foreign Shirt", quantity: 1, products: { stock_status: "instock" } },
    ],
  });

const hasOrder = (orderNumber: string) => screen.queryAllByText(`#${orderNumber}`).length > 0;

describe("Orders reads are scoped to the active business's stores", () => {
  beforeEach(() => {
    fromMock.mockReset();
    permissionsMock.mockReturnValue({ can: () => true });
    printInvoiceMock.mockReset();
    currentContext = {};
    contextMock.mockImplementation(() => currentContext);
    rows = {};
    ordersById = {};
    installClient();

    rows.stores = [
      { id: "s1", name: "Store One" },
      { id: "s2", name: "Store Two" },
    ];
    rows.categories = [{ id: "c1", name: "Shirts", parent_id: null, store_id: "s1" }];
    rows.product_categories = [{ product_id: "p1", category_id: "c1" }];
    rows.orders = [orderRow()];
    ordersById = { o1: orderRow({ subtotal: 500, discount: 0, shipping_cost: 0, notes: null }) };
    setActiveBusiness("b1", BIZ_ONE_STORES);
    mark();
  });

  afterEach(() => {
    cleanup();
  });

  it("scopes the orders list, the store selector, the category selector and the category map", async () => {
    renderOrders();

    await waitFor(() => expect(hasOrder("1001")).toBe(true));

    // Orders: "All stores" means all stores of the ACTIVE business, never every
    // store the RLS policies happen to allow.
    expect(argsFor("orders", "in")).toEqual([["store_id", BIZ_ONE_STORES]]);
    // The unscoped store filter that caused the leak is gone.
    expect(argsFor("orders", "eq").some((args) => args[0] === "store_id")).toBe(false);

    // Store selector: the seam's own scoped read, never an unscoped one. (The
    // closed detail sheet holds a scope hook of its own, so more than one scoped
    // stores read is expected — none of them unscoped.)
    const storeReadScopes = argsFor("stores", "in");
    expect(storeReadScopes.length).toBeGreaterThan(0);
    expect(
      storeReadScopes.every((args) => JSON.stringify(args) === JSON.stringify(["id", BIZ_ONE_STORES])),
    ).toBe(true);
    // Category selector.
    const categoryReadScopes = argsFor("categories", "in");
    expect(categoryReadScopes.length).toBeGreaterThan(0);
    expect(
      categoryReadScopes.every(
        (args) => JSON.stringify(args) === JSON.stringify(["store_id", BIZ_ONE_STORES]),
      ),
    ).toBe(true);
    // product_categories has no store_id: it is bounded by the products of the
    // already-scoped orders, so it cannot pull in another business's rows.
    expect(argsFor("product_categories", "in")).toEqual([["product_id", ["p1"]]]);

    // No operational read in this sweep lacks a tenant predicate.
    expect(ordersReadScopes()).toEqual([BIZ_ONE_STORES]);
  });

  it("fails closed when the active business has no mapped stores: no operational read at all", async () => {
    setActiveBusiness("b1", []);
    mark();

    renderOrders("/orders?tab=all");

    await waitFor(() => expect(screen.getByText("No orders found")).toBeInTheDocument());

    // The page still reads its own (non-tenant) settings, but not one row of
    // operational data: an empty scope is "no stores readable", not "all stores".
    expect(operationalQueries()).toEqual([]);
    expect(hasOrder("1001")).toBe(false);
  });

  it("fails closed on a store filter that belongs to another business", async () => {
    // A store filter carried over from the previous business (deep link, back
    // button, stale session) must never become a scope of its own — and must not
    // silently degrade into "every store of this business" either.
    renderOrders("/orders?store=s9&tab=all");

    await waitFor(() => expect(screen.getByText("No orders found")).toBeInTheDocument());

    // Not one order row is read — the filter alone can neither widen the scope
    // back nor pick a store of its own — and no product_categories mapping can
    // follow from a read that never happened.
    expect(queriesFor("orders")).toEqual([]);
    expect(queriesFor("product_categories")).toEqual([]);
    // The category selector may still load (it belongs to the business, not to
    // the store filter), but only for this business's stores.
    expect(argsFor("categories", "in")).not.toContainEqual(["store_id", ["s9"]]);
    expect(
      argsFor("categories", "in").every(
        (args) => JSON.stringify(args) === JSON.stringify(["store_id", BIZ_ONE_STORES]),
      ),
    ).toBe(true);
    expect(hasOrder("1001")).toBe(false);
  });

  it("never publishes a row whose store is outside the active business", async () => {
    // Defence in depth: even if a foreign row reaches the list payload (a
    // service-role read, a stale cache, a predicate mistake), the page must not
    // surface it — and must not let its order_items feed the category map.
    rows.orders = [orderRow(), foreignOrderRow()];

    renderOrders();

    await waitFor(() => expect(hasOrder("1001")).toBe(true));
    expect(hasOrder("9001")).toBe(false);
    expect(argsFor("product_categories", "in")).toEqual([["product_id", ["p1"]]]);
  });

  it("re-runs every scoped read with the new business's stores on a switch", async () => {
    const view = renderOrders();
    await waitFor(() => expect(hasOrder("1001")).toBe(true));

    mark();
    rows.stores = [{ id: "s9", name: "Store Nine" }];
    rows.categories = [{ id: "c9", name: "Sprockets", parent_id: null, store_id: "s9" }];
    rows.orders = [orderRow({ id: "o9", order_number: "9001", store_id: "s9", stores: { name: "Store Nine" } })];
    setActiveBusiness("b2", BIZ_TWO_STORES);
    view.rerender(
      <MemoryRouter initialEntries={["/orders"]}>
        <Orders />
      </MemoryRouter>,
    );

    await waitFor(() => expect(hasOrder("9001")).toBe(true));

    expect(argsFor("orders", "in")).toContainEqual(["store_id", BIZ_TWO_STORES]);
    expect(argsFor("stores", "in")).toContainEqual(["id", BIZ_TWO_STORES]);
    expect(argsFor("categories", "in")).toContainEqual(["store_id", BIZ_TWO_STORES]);
    // The previous business's stores are never queried again.
    expect(argsFor("orders", "in")).not.toContainEqual(["store_id", BIZ_ONE_STORES]);
    expect(argsFor("stores", "in")).not.toContainEqual(["id", BIZ_ONE_STORES]);
    expect(hasOrder("1001")).toBe(false);
  });

  it("scopes the reprint detail read and skips it for an order outside the business", async () => {
    // Without the attach-parcel action the row's Print action is one of the
    // three inline buttons instead of hiding behind the overflow menu.
    permissionsMock.mockReturnValue({ can: (p: string) => p !== "orders.attach_courier" });
    rows.orders = [orderRow({ status: "delivered", consignment_id: "c1" })];

    renderOrders("/orders?tab=delivered");
    await waitFor(() => expect(screen.getAllByLabelText("Print Invoice").length).toBeGreaterThan(0));

    // In scope: the detail read carries the tenant predicate alongside the id.
    mark();
    fireEvent.click(screen.getAllByLabelText("Print Invoice")[0]);
    await waitFor(() => expect(printInvoiceMock).toHaveBeenCalled());

    const reprint = queriesFor("orders")[0];
    expect(reprint.calls).toContainEqual({ method: "eq", args: ["id", "o1"] });
    expect(reprint.calls).toContainEqual({ method: "in", args: ["store_id", BIZ_ONE_STORES] });
    expect(argsFor("order_items", "eq")).toContainEqual(["order_id", "o1"]);
    expect(argsFor("order_payments", "eq")).toContainEqual(["order_id", "o1"]);

    // Out of scope: the scoped read yields nothing, so nothing is printed and
    // the child rows of that order are never fetched.
    ordersById = {};
    mark();
    fireEvent.click(screen.getAllByLabelText("Print Invoice")[0]);
    await waitFor(() => expect(queriesFor("orders")).toHaveLength(1));
    expect(queriesFor("orders")[0].calls).toContainEqual({ method: "in", args: ["store_id", BIZ_ONE_STORES] });
    expect(queriesFor("order_items")).toEqual([]);
    expect(queriesFor("order_payments")).toEqual([]);
    expect(printInvoiceMock).toHaveBeenCalledTimes(1);
  });
});
