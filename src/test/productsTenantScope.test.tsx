import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { installFakeTenantClient, type Query, type QueryCall, type Row } from "@/test/support/tenantScopedClient";

// Hybrid tenancy (issue #16), Products surface: EVERY read and mutation the
// products list issues must be limited to the active business's stores, and an
// empty scope must FAIL CLOSED (no query at all) instead of reading every row
// the RLS policies happen to allow. The Supabase client, the business context
// and the permissions hook are module-mocked (precedent:
// src/test/useStoresList.test.tsx, src/test/appSidebarCategoryScope.test.tsx).

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: null } })) },
  },
}));

vi.mock("@/hooks/useBusinessContext", () => ({ useBusinessContext: vi.fn() }));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: vi.fn(() => ({
    permissions: [],
    storeIds: [],
    loading: false,
    can: () => true,
    canAny: () => true,
    hasStoreAccess: () => true,
    refresh: vi.fn(),
  })),
}));

import { supabase } from "@/integrations/supabase/client";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import ProductList from "@/components/products/ProductList";

const contextMock = useBusinessContext as unknown as Mock;

const BIZ_ONE = "11111111-1111-1111-1111-111111111111";
const BIZ_TWO = "22222222-2222-2222-2222-222222222222";

const client = installFakeTenantClient(supabase as never);

const STORE_ONE = { id: "s1", name: "Store One", status: "connected" };
const STORE_NINE = { id: "s9", name: "Store Nine", status: "connected" };

const productRow = (over: Row = {}): Row => ({
  id: "p1",
  name: "Widget",
  sku: "W-1",
  category: null,
  image_url: null,
  stock_quantity: 5,
  manage_stock: true,
  stock_status: "in_stock",
  price: 100,
  is_active: true,
  store_id: "s1",
  is_featured: false,
  sales_count: 0,
  ...over,
});

const categoryRow = (over: Row = {}): Row => ({
  id: "c1",
  name: "Widgets",
  parent_id: null,
  store_id: "s1",
  ...over,
});

let currentContext: Record<string, unknown> = {};

/** The context value the list sees; the "switch" swaps it like the provider. */
const setActiveBusiness = (id: string, storeIds: string[]) => {
  currentContext = {
    active: { id, name: "Business", logo_url: null, currency: "BDT" },
    businesses: [{ id, name: "Business", logo_url: null }],
    brands: storeIds.map((storeId) => ({ woo_store_id: storeId })),
    brandStores: [],
    activeBrand: null,
    myRole: "owner",
    rolesByBusiness: { [id]: "owner" },
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

/** The store-id predicates a query carries (`in("store_id", ids)`). */
const storeScopeOf = (query: Query | undefined): unknown[][] =>
  (query?.calls ?? [])
    .filter(
      (call): call is QueryCall & { args: [string, unknown[]] } =>
        call.method === "in" && call.args[0] === "store_id",
    )
    .map((call) => call.args[1]);

const storeIdScopes = (queries: Query[]): unknown[][] => queries.flatMap(storeScopeOf);

beforeEach(() => {
  client.installUiShims();
  client.reset({});
  contextMock.mockImplementation(() => currentContext);
  setActiveBusiness(BIZ_ONE, ["s1"]);
});

afterEach(() => {
  cleanup();
});

describe("ProductList scopes every products read to the active business's stores", () => {
  it("bounds products, categories and the child links to the business's stores", async () => {
    client.setRows({
      stores: [STORE_ONE],
      products: [productRow()],
      categories: [categoryRow()],
      product_categories: [{ product_id: "p1", category_id: "c1" }],
    });

    render(<ProductList />);
    expect((await screen.findAllByText("Widget")).length).toBeGreaterThan(0);

    // The products read carries the tenant predicate — and there is exactly one.
    const productsQueries = client.queriesFor("products");
    expect(productsQueries).toHaveLength(1);
    expect(storeScopeOf(productsQueries[0])).toEqual([["s1"]]);

    // Categories belong to a store too.
    expect(storeIdScopes(client.queriesFor("categories"))).toEqual([["s1"]]);

    // product_categories has no store_id: it is bounded by the tenant-scoped
    // product ids that were just read, so another business's links never load.
    const linkQueries = client.queriesFor("product_categories");
    expect(linkQueries).toHaveLength(1);
    expect(
      linkQueries[0].calls.filter((call) => call.method === "in").map((call) => call.args),
    ).toEqual([["product_id", ["p1"]]]);

    // The store list itself is never read without a tenant bound.
    expect(
      client
        .queriesFor("stores")
        .every((query) =>
          query.calls.some((call) => call.method === "in" && call.args[0] === "id"),
        ),
    ).toBe(true);

    // The business's own row is what surfaces (a leaked row would appear here).
    expect(screen.getByText("1 products")).toBeInTheDocument();
  });

  it("fails closed when the active business has no stores: no query at all", async () => {
    client.setRows({
      stores: [STORE_ONE],
      products: [productRow()],
      categories: [categoryRow()],
    });
    setActiveBusiness(BIZ_ONE, []); // a business, zero brand-store links

    render(<ProductList />);
    expect((await screen.findAllByText("No products found.")).length).toBeGreaterThan(0);

    expect(client.all()).toHaveLength(0);
    expect(screen.getByText("0 products")).toBeInTheDocument();
  });

  it("re-scopes on a business switch and never re-reads the previous business's stores", async () => {
    client.setRows({
      stores: [STORE_ONE],
      products: [productRow()],
      categories: [categoryRow()],
      product_categories: [{ product_id: "p1", category_id: "c1" }],
    });

    const { rerender } = render(<ProductList />);
    expect((await screen.findAllByText("Widget")).length).toBeGreaterThan(0);

    client.mark();
    setActiveBusiness(BIZ_TWO, ["s9"]);
    client.setRows({
      stores: [STORE_NINE],
      products: [productRow({ id: "p9", name: "Sprocket", store_id: "s9" })],
      categories: [],
      product_categories: [],
    });
    rerender(<ProductList />);

    expect((await screen.findAllByText("Sprocket")).length).toBeGreaterThan(0);

    const afterSwitch = client.sinceMark();
    expect(storeIdScopes(afterSwitch)).toContainEqual(["s9"]);
    // Nothing issued after the switch may still be scoped to the old business.
    const everyInArgument = afterSwitch
      .flatMap((query) => query.calls.filter((call) => call.method === "in"))
      .flatMap((call) => (call.args[1] as unknown[]).flat());
    expect(everyInArgument).not.toContain("s1");
  });

  it("assigns only categories of the active business, on a scoped statement", async () => {
    client.setRows({
      stores: [STORE_ONE],
      products: [productRow()],
      categories: [categoryRow(), categoryRow({ id: "c9", name: "Foreign", store_id: "s9" })],
      product_categories: [{ product_id: "p1", category_id: "c1" }],
    });

    render(<ProductList />);
    expect((await screen.findAllByText("Widget")).length).toBeGreaterThan(0);

    // Select the product through its row checkbox, then open bulk categories.
    const rowCheckboxes = screen.getAllByRole("checkbox");
    fireEvent.click(rowCheckboxes[rowCheckboxes.length - 1]);
    expect(await screen.findByText("1 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^categories$/i }));

    const dialog = await screen.findByRole("dialog");
    // The other business's category is not offered at all.
    expect(within(dialog).queryByText("Foreign")).toBeNull();
    fireEvent.click(within(dialog).getByRole("checkbox"));

    fireEvent.click(within(dialog).getByRole("button", { name: /assign to 1 product/i }));

    await waitFor(() => expect(client.argsFor("product_categories", "insert")).toHaveLength(1));
    // `insert(rows)` — the payload is the row array.
    expect(client.argsFor("product_categories", "insert")[0][0]).toEqual([
      { product_id: "p1", category_id: "c1" },
    ]);

    // The denormalised label write is tenant-predicated too.
    const assignUpdate = client.firstQuery("products", "update");
    expect(storeScopeOf(assignUpdate)).toEqual([["s1"]]);
  });

  it("takes the Woo sync targets from the scoped store list, never an unscoped status query", async () => {
    client.setRows({
      stores: [STORE_ONE],
      products: [productRow()],
      categories: [],
      product_categories: [],
    });

    render(<ProductList />);
    expect((await screen.findAllByText("Widget")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /sync products/i }));

    await waitFor(() =>
      expect(client.invoke).toHaveBeenCalledWith("woo-sync", { body: { store_id: "s1" } }),
    );
    const storeQueries = client.queriesFor("stores");
    expect(storeQueries.length).toBeGreaterThan(0);
    expect(
      storeQueries.every((query) =>
        query.calls.some((call) => call.method === "in" && call.args[0] === "id"),
      ),
    ).toBe(true);
    expect(
      storeQueries.some((query) =>
        query.calls.some((call) => call.method === "eq" && call.args[0] === "status"),
      ),
    ).toBe(false);
  });
});
