import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { installFakeTenantClient, type Query, type QueryCall, type Row } from "@/test/support/tenantScopedClient";

// Hybrid tenancy (issue #16), categories tab: the categories it lists, the
// parents it offers, the stores it syncs to and every write it performs must be
// limited to the active business's stores. An empty scope must fail closed (no
// query at all), and a category may never be created without a store of the
// active business — RLS requires categories.store_id. Supabase and the business
// context are module-mocked (precedent: src/test/useStoresList.test.tsx).

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: null } })) },
  },
}));

vi.mock("@/hooks/useBusinessContext", () => ({ useBusinessContext: vi.fn() }));

import { supabase } from "@/integrations/supabase/client";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import CategoriesTab from "@/components/products/CategoriesTab";

const contextMock = useBusinessContext as unknown as Mock;

const BIZ_ONE = "11111111-1111-1111-1111-111111111111";

const client = installFakeTenantClient(supabase as never);

const categoryRow = (over: Row = {}): Row => ({
  id: "c1",
  name: "Widgets",
  slug: "widgets",
  parent_id: null,
  store_id: "s1",
  woo_category_id: null,
  created_at: "2026-10-26T00:00:00.000Z",
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

beforeEach(() => {
  client.installUiShims();
  client.reset({});
  contextMock.mockImplementation(() => currentContext);
  setActiveBusiness(BIZ_ONE, ["s1"]);
});

afterEach(() => {
  cleanup();
});

describe("CategoriesTab scopes categories and stores to the active business", () => {
  it("lists only the business's categories, read under the tenant predicate", async () => {
    client.setRows({
      stores: [{ id: "s1", name: "Store One", status: "connected" }],
      categories: [categoryRow()],
      product_categories: [{ category_id: "c1", product_id: "p1" }],
    });

    render(<CategoriesTab />);
    expect(await screen.findByText("Widgets")).toBeInTheDocument();

    const categoryQueries = client.queriesFor("categories");
    expect(categoryQueries).toHaveLength(1);
    expect(storeScopeOf(categoryQueries[0])).toEqual([["s1"]]);
    expect(screen.getByText("1 categories")).toBeInTheDocument();
  });

  it("fails closed when the active business has no stores: no query at all", async () => {
    client.setRows({
      stores: [{ id: "s1", name: "Store One", status: "connected" }],
      categories: [categoryRow()],
    });
    setActiveBusiness(BIZ_ONE, []);

    render(<CategoriesTab />);
    expect(await screen.findByText("No categories found.")).toBeInTheDocument();

    expect(client.all()).toHaveLength(0);
    expect(screen.getByText("0 categories")).toBeInTheDocument();
  });

  it("deletes a category on a tenant-predicated statement", async () => {
    client.setRows({
      stores: [{ id: "s1", name: "Store One", status: "connected" }],
      categories: [categoryRow()],
      product_categories: [],
    });

    render(<CategoriesTab />);
    expect(await screen.findByText("Widgets")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /delete category/i }));

    await waitFor(() => expect(client.firstQuery("categories", "delete")).toBeDefined());
    expect(storeScopeOf(client.firstQuery("categories", "delete"))).toEqual([["s1"]]);
    // The link cleanup is bounded by the category id it just verified.
    expect(
      client.argsFor("product_categories", "delete"),
    ).toHaveLength(1);
  });

  it("updates a category under the tenant predicate and drops a foreign parent", async () => {
    client.setRows({
      stores: [{ id: "s1", name: "Store One", status: "connected" }],
      // c9 is another business's category: the loaded row points at it, but it is
      // not in this business's scope, so it can never become this row's parent.
      categories: [
        categoryRow({ parent_id: "c9" }),
        categoryRow({ id: "c9", name: "Foreign", store_id: "s9" }),
      ],
      product_categories: [],
    });

    render(<CategoriesTab />);
    expect(await screen.findByText("Widgets")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Widgets"));
    fireEvent.click(await screen.findByRole("button", { name: /^update$/i }));

    await waitFor(() => expect(client.firstQuery("categories", "update")).toBeDefined());
    const update = client.firstQuery("categories", "update");
    expect(storeScopeOf(update)).toEqual([["s1"]]);
    expect(update?.calls.find((call) => call.method === "update")?.args[0]).toMatchObject({
      parent_id: null,
    });
  });

  it("refuses to create a category when no store of the business is selected", async () => {
    client.setRows({
      // The business's only store is not connected, so nothing is preselectable.
      stores: [{ id: "s1", name: "Store One", status: "disconnected" }],
      categories: [],
      product_categories: [],
    });

    render(<CategoriesTab />);
    expect(await screen.findByText("No categories found.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /add category/i }));
    fireEvent.change(screen.getByPlaceholderText("Category name"), {
      target: { value: "Storeless" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(screen.getByPlaceholderText("Category name")).toBeInTheDocument());
    expect(client.argsFor("categories", "insert")).toHaveLength(0);
  });

  it("creates a category inside a store of the active business", async () => {
    client.setRows({
      stores: [{ id: "s1", name: "Store One", status: "connected" }],
      categories: [],
      product_categories: [],
    });

    render(<CategoriesTab />);
    expect(await screen.findByText("No categories found.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /add category/i }));
    fireEvent.change(screen.getByPlaceholderText("Category name"), {
      target: { value: "New Category" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(client.argsFor("categories", "insert")).toHaveLength(1));
    expect(client.argsFor("categories", "insert")[0][0]).toMatchObject({ store_id: "s1" });
  });

  it("syncs only the stores the business owns", async () => {
    client.setRows({
      stores: [{ id: "s1", name: "Store One", status: "connected" }],
      categories: [],
      product_categories: [],
    });

    render(<CategoriesTab />);
    expect(await screen.findByText("No categories found.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /sync categories/i }));

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
  });
});
