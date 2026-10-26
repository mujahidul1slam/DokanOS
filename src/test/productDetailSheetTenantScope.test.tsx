import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { installFakeTenantClient, type Query, type QueryCall, type Row } from "@/test/support/tenantScopedClient";

// Hybrid tenancy (issue #16), product detail sheet: the product it opens, the
// categories it offers and every write it performs must be limited to the active
// business's stores. A product of another business must not load (nor its child
// rows), a category of another business must never be assignable, and an empty
// scope must fail closed before any query. Supabase, the business context and
// the permissions hook are module-mocked (precedent:
// src/test/useStoresList.test.tsx).

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
import ProductDetailSheet from "@/components/products/ProductDetailSheet";

const contextMock = useBusinessContext as unknown as Mock;

const BIZ_ONE = "11111111-1111-1111-1111-111111111111";

const client = installFakeTenantClient(supabase as never);

const productRow = (over: Row = {}): Row => ({
  id: "p1",
  name: "Widget",
  sku: "W-1",
  price: 100,
  regular_price: 100,
  sale_price: null,
  cost_price: 0,
  description: null,
  short_description: null,
  category: null,
  image_url: null,
  barcode: null,
  manage_stock: true,
  stock_quantity: 5,
  stock_status: "in_stock",
  is_active: true,
  weight: null,
  woo_product_id: null,
  store_id: "s1",
  ...over,
});

let currentContext: Record<string, unknown> = {};

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

const storeScopeOf = (query: Query | undefined): unknown[][] =>
  (query?.calls ?? [])
    .filter(
      (call): call is QueryCall & { args: [string, unknown[]] } =>
        call.method === "in" && call.args[0] === "store_id",
    )
    .map((call) => call.args[1]);

const renderSheet = (productId: string | null = "p1") => {
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  const view = render(
    <ProductDetailSheet
      productId={productId}
      open
      onOpenChange={onOpenChange}
      onSaved={onSaved}
      defaultStoreId="s1"
    />,
  );
  return { ...view, onOpenChange, onSaved };
};

beforeEach(() => {
  client.installUiShims();
  client.reset({});
  contextMock.mockImplementation(() => currentContext);
  setActiveBusiness(BIZ_ONE, ["s1"]);
});

afterEach(() => {
  cleanup();
});

describe("ProductDetailSheet scopes its reads and writes to the active business", () => {
  it("loads the product and the assignable categories under the tenant predicate", async () => {
    client.setRows({
      stores: [{ id: "s1", name: "Store One", status: "connected" }],
      products: [productRow()],
      categories: [{ id: "c1", name: "Widgets", slug: "widgets", parent_id: null, store_id: "s1" }],
      product_categories: [{ product_id: "p1", category_id: "c1" }],
      product_variations: [],
    });

    renderSheet();
    // The sheet's own category tree (default tab) proves the load completed.
    expect((await screen.findAllByText("Widgets")).length).toBeGreaterThan(0);

    const productQuery = client.firstQuery("products", "select");
    expect(storeScopeOf(productQuery)).toEqual([["s1"]]);
    expect(
      productQuery?.calls.some((call) => call.method === "eq" && call.args[0] === "id"),
    ).toBe(true);

    // The category tree offered for assignment is the business's own.
    expect(storeScopeOf(client.firstQuery("categories", "select"))).toEqual([["s1"]]);
  });

  it("fails closed with an empty business scope: no reads and no writes", async () => {
    client.setRows({
      stores: [{ id: "s1", name: "Store One", status: "connected" }],
      products: [productRow()],
      categories: [{ id: "c1", name: "Widgets", slug: "widgets", parent_id: null, store_id: "s1" }],
    });
    setActiveBusiness(BIZ_ONE, []); // a business with zero brand-store links

    renderSheet();
    expect(await screen.findByText(/No categories yet/i)).toBeInTheDocument();
    expect(client.all()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /save product/i }));
    await waitFor(() => expect(client.argsFor("products", "insert")).toHaveLength(0));

    expect(client.argsFor("products", "insert")).toHaveLength(0);
    expect(client.argsFor("products", "update")).toHaveLength(0);
    expect(client.argsFor("product_categories", "insert")).toHaveLength(0);
  });

  it("never assigns a category outside the business when saving", async () => {
    client.setRows({
      stores: [{ id: "s1", name: "Store One", status: "connected" }],
      products: [productRow()],
      categories: [{ id: "c1", name: "Widgets", slug: "widgets", parent_id: null, store_id: "s1" }],
      // c9 is another business's category, already linked to this product.
      product_categories: [
        { product_id: "p1", category_id: "c1" },
        { product_id: "p1", category_id: "c9" },
      ],
      product_variations: [],
    });

    renderSheet();
    expect((await screen.findAllByText("Widgets")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /save product/i }));

    await waitFor(() => expect(client.argsFor("product_categories", "insert")).toHaveLength(1));
    // `insert(rows)` — the payload is the row array.
    expect(client.argsFor("product_categories", "insert")[0][0]).toEqual([
      { product_id: "p1", category_id: "c1" },
    ]);
    // The product write carries the tenant predicate as well.
    expect(storeScopeOf(client.firstQuery("products", "update"))).toEqual([["s1"]]);
  });

  it("does not open a product of another business, nor read its child rows", async () => {
    client.setRows({
      stores: [{ id: "s1", name: "Store One", status: "connected" }],
      // p9 lives in store s9: no business context here may read it.
      products: [productRow({ id: "p9", name: "Foreign", store_id: "s9" })],
      categories: [{ id: "c9", name: "Foreign", slug: "foreign", parent_id: null, store_id: "s9" }],
      product_categories: [{ product_id: "p9", category_id: "c9" }],
      product_variations: [{ id: "v1", product_id: "p9", name: "V", price: 1 }],
    });

    const { onOpenChange } = renderSheet("p9");

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(client.queriesFor("product_variations")).toHaveLength(0);
    expect(client.queriesFor("product_categories")).toHaveLength(0);
    expect(screen.queryByDisplayValue("Foreign")).toBeNull();
  });
});
