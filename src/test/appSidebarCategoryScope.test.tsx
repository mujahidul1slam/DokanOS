import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

// Hybrid tenancy (issue #16): the sidebar used to load categories with
// categories.store_id = ACTIVE BUSINESS ID, which is a different column, so a
// new-model business (its id is not a store id) saw no categories at all. The
// query must instead use the active business's store ids, and must fail closed
// when there are none. The Supabase client and every context hook are
// module-mocked (precedent: src/test/useStoresList.test.tsx).

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn() },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useTheme", () => ({ useTheme: vi.fn() }));
vi.mock("@/hooks/useBusinessProfile", () => ({ useBusinessProfile: vi.fn() }));
vi.mock("@/hooks/useBusinessContext", () => ({ useBusinessContext: vi.fn() }));

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { useBusinessProfile } from "@/hooks/useBusinessProfile";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import AppSidebar from "@/components/AppSidebar";

const fromMock = supabase.from as unknown as Mock;
const authMock = useAuth as unknown as Mock;
const themeMock = useTheme as unknown as Mock;
const profileMock = useBusinessProfile as unknown as Mock;
const contextMock = useBusinessContext as unknown as Mock;

const BUSINESS_ID = "11111111-1111-1111-1111-111111111111";
const BUSINESS_TWO_ID = "22222222-2222-2222-2222-222222222222";

type Query = { table: string; calls: Array<{ method: string; args: unknown[] }> };
let queries: Query[] = [];
let storeRows: Array<{ id: string; name: string; status: string }> = [];
let categoryRows: Array<{ id: string; name: string }> = [];

/** Chainable query-builder mock that records every predicate applied to it. */
const makeBuilder = (query: Query, data: unknown[]) => {
  const b: Record<string, unknown> = {};
  for (const method of ["select", "order", "in", "eq", "maybeSingle"]) {
    b[method] = vi.fn((...args: unknown[]) => {
      query.calls.push({ method, args });
      return b;
    });
  }
  b.then = (onFulfilled: (v: { data: unknown[]; error: null }) => unknown) =>
    Promise.resolve({ data, error: null }).then(onFulfilled);
  return b;
};

/** The category reads' tenant predicates, so the scope column can be asserted. */
const categoriesInArgs = (from = 0) =>
  queries
    .slice(from)
    .filter((q) => q.table === "categories")
    .flatMap((q) => q.calls.filter((c) => c.method === "in").map((c) => c.args));

const hasCategoriesQuery = () => queries.some((q) => q.table === "categories");

/** The sidebar's own reads, resolved by table so they cannot be faked. */
const installClient = () => {
  queries = [];
  fromMock.mockImplementation((table: string) => {
    const query: Query = { table, calls: [] };
    queries.push(query);
    if (table === "stores") return makeBuilder(query, storeRows);
    if (table === "categories") return makeBuilder(query, categoryRows);
    return makeBuilder(query, []);
  });
};

let currentContext: Record<string, unknown> = {};

/** The context value the sidebar sees; the "switch" swaps it like the provider. */
const setActiveBusiness = (id: string, brands: Array<{ woo_store_id: string | null }>) => {
  currentContext = {
    active: { id, name: "Business", logo_url: null },
    businesses: [{ id, name: "Business", logo_url: null }],
    brands,
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

/**
 * One element instance plus the query client behind it, so a "switch" can do
 * exactly what the real switcher does (cancel + drop tenant-scoped cache) and
 * then re-render the SAME tree instead of remounting it.
 */
const renderSidebar = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(MemoryRouter, null, children),
    );
  const view = render(createElement(AppSidebar), { wrapper });
  const switchTo = async (id: string, brands: Array<{ woo_store_id: string | null }>) => {
    await queryClient.cancelQueries();
    queryClient.removeQueries();
    setActiveBusiness(id, brands);
    view.rerender(createElement(AppSidebar));
  };
  return { ...view, switchTo, element: createElement(AppSidebar) };
};

/** Opens the Catalog > Products submenu so its category links render. */
const openProductsSubmenu = () => {
  const [products] = screen.getAllByRole("link", { name: /products/i });
  fireEvent.click(products);
};

describe("AppSidebar categories are scoped to the active business's stores", () => {
  beforeEach(() => {
    fromMock.mockReset();
    authMock.mockReturnValue({
      user: { id: "u1", email: "owner@example.com" },
      role: "admin",
      signOut: vi.fn(),
    });
    themeMock.mockReturnValue({ theme: "light", toggleTheme: vi.fn() });
    profileMock.mockReturnValue({ active: null, profiles: [], setActive: vi.fn() });
    currentContext = {};
    contextMock.mockImplementation(() => currentContext);
    storeRows = [];
    categoryRows = [];
    installClient();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads categories by the active business's store ids, never by the business id", async () => {
    storeRows = [{ id: "s1", name: "Store One", status: "connected" }];
    categoryRows = [{ id: "c1", name: "Widgets" }];
    setActiveBusiness(BUSINESS_ID, [{ woo_store_id: "s1" }]);

    renderSidebar();
    await waitFor(() => expect(categoriesInArgs()).toEqual([["store_id", ["s1"]]]));

    const categoryQuery = queries.find((q) => q.table === "categories");
    // The wrong column: the business id must never be used as a store id.
    expect(categoryQuery?.calls.some((c) => c.method === "eq" && c.args[0] === "store_id")).toBe(false);
    expect(categoryQuery?.calls.some((c) => c.args?.includes(BUSINESS_ID))).toBe(false);
  });

  it("renders the categories it loaded for the active business", async () => {
    storeRows = [{ id: "s1", name: "Store One", status: "connected" }];
    categoryRows = [
      { id: "c1", name: "Widgets" },
      { id: "c2", name: "Gizmos" },
    ];
    setActiveBusiness(BUSINESS_ID, [{ woo_store_id: "s1" }]);

    renderSidebar();
    await waitFor(() => expect(categoriesInArgs()).toHaveLength(1));
    openProductsSubmenu();

    const widgets = await screen.findAllByText("Widgets");
    expect(widgets.length).toBeGreaterThan(0);
    expect(widgets[0].closest("a")).toHaveAttribute("href", "/products?category=c1");
    expect((await screen.findAllByText("Gizmos")).length).toBeGreaterThan(0);
  });

  it("fails closed when the active business has no stores: no categories query at all", async () => {
    storeRows = [];
    categoryRows = [{ id: "c1", name: "Widgets" }];
    setActiveBusiness(BUSINESS_ID, []); // active business, zero brand-store links

    renderSidebar();
    openProductsSubmenu();

    await waitFor(() => expect(queries.some((q) => q.table === "stores")).toBe(false));
    expect(hasCategoriesQuery()).toBe(false);
    expect(screen.queryByText("Widgets")).toBeNull();
  });

  it("re-queries with the new business's stores when the business is switched", async () => {
    storeRows = [{ id: "s1", name: "Store One", status: "connected" }];
    categoryRows = [{ id: "c1", name: "Widgets" }];
    setActiveBusiness(BUSINESS_ID, [{ woo_store_id: "s1" }]);

    const { switchTo } = renderSidebar();
    await waitFor(() => expect(categoriesInArgs()).toEqual([["store_id", ["s1"]]]));

    // Switch: the new business maps to a different store.
    const markedAt = queries.length;
    storeRows = [{ id: "s9", name: "Store Nine", status: "connected" }];
    categoryRows = [{ id: "c9", name: "Sprockets" }];
    await switchTo(BUSINESS_TWO_ID, [{ woo_store_id: "s9" }]);

    await waitFor(() => expect(categoriesInArgs(markedAt)).toContainEqual(["store_id", ["s9"]]));
    // The switch drops the previous business's stores, so no query issued after
    // it can still be scoped to the previous business's store.
    expect(categoriesInArgs(markedAt)).not.toContainEqual(["store_id", ["s1"]]);
    expect(categoriesInArgs(markedAt)[categoriesInArgs(markedAt).length - 1]).toEqual(["store_id", ["s9"]]);
  });
});
