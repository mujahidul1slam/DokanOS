import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, render, screen, waitFor, type RenderResult } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

// Hybrid tenancy (issue #16): with the active business having no mapped stores,
// every KPI query inside useDashboardData fails closed, so the page used to
// render a full dashboard shell of zeroed KPIs — indistinguishable from a
// business that is simply quiet. It must say what is actually wrong instead.
//
// The page, the scope seam and the KPI hook all run for real; the Supabase client
// and the business context are module-mocked (precedent:
// src/test/appSidebarCategoryScope.test.tsx), and the child cards are stubbed
// because this file is about the PAGE's decision.

vi.mock("@/hooks/useBusinessContext", () => ({
  useBusinessContext: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn() },
}));

vi.mock("@/lib/exportOrdersCSV", () => ({ exportOrdersToCSV: vi.fn() }));

vi.mock("@/components/dashboard/ActionQueue", () => ({ default: vi.fn(() => null) }));
vi.mock("@/components/dashboard/FulfillmentFunnel", () => ({ default: vi.fn(() => null) }));
vi.mock("@/components/dashboard/OrderPipeline", () => ({ default: vi.fn(() => null) }));
vi.mock("@/components/dashboard/StoreHealthGrid", () => ({ default: vi.fn(() => null) }));
vi.mock("@/components/dashboard/SyncHealthCard", () => ({ default: vi.fn(() => null) }));
vi.mock("@/components/dashboard/CourierDispatchStation", () => ({ default: vi.fn(() => null) }));
vi.mock("@/components/dashboard/TopProducts", () => ({ default: vi.fn(() => null) }));
vi.mock("@/components/dashboard/SourceMix", () => ({ default: vi.fn(() => null) }));
vi.mock("@/components/dashboard/DashboardHeader", () => ({ default: vi.fn(() => null) }));
vi.mock("@/components/dashboard/KpiStats", () => ({ default: vi.fn(() => null) }));
vi.mock("@/components/dashboard/RevenueTrendChart", () => ({ default: vi.fn(() => null) }));
vi.mock("@/components/dashboard/RecentOrdersList", () => ({ default: vi.fn(() => null) }));
vi.mock("@/components/dashboard/LowStockAlert", () => ({ default: vi.fn(() => null) }));

import { useBusinessContext } from "@/hooks/useBusinessContext";
import { supabase } from "@/integrations/supabase/client";
import Dashboard from "@/pages/Dashboard";
import KpiStats from "@/components/dashboard/KpiStats";
import StoreHealthGrid from "@/components/dashboard/StoreHealthGrid";
import SyncHealthCard from "@/components/dashboard/SyncHealthCard";

const ctxMock = useBusinessContext as unknown as Mock;
const fromMock = supabase.from as unknown as Mock;
const kpiMock = KpiStats as unknown as Mock;
const storeHealthMock = StoreHealthGrid as unknown as Mock;
const syncHealthMock = SyncHealthCard as unknown as Mock;

const EMPTY_STATE_TITLE = "No stores in this business";

type Query = { table: string; calls: Array<{ method: string; args: unknown[] }> };
let queries: Query[] = [];
let rows: Record<string, unknown[]> = {};
let counts: Record<string, number> = {};
/** When true, the stores read never settles (the scope is still resolving). */
let holdStores = false;

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
    (holdStores && query.table === "stores"
      ? new Promise<Record<string, unknown>>(() => {})
      : Promise.resolve(result)
    ).then(onFulfilled);
  return b;
};

const installClient = () => {
  queries = [];
  fromMock.mockImplementation((table: string) => {
    const query: Query = { table, calls: [] };
    queries.push(query);
    return makeBuilder(query, { data: rows[table] ?? [], error: null, count: counts[table] ?? 0 });
  });
};

const contextFor = (brands: Array<{ woo_store_id: string | null }>, activeId: string | null = "b1") =>
  ctxMock.mockReturnValue({ brands, active: activeId ? { id: activeId } : null, loading: false, contextReady: true });

const page = () => (
  <MemoryRouter>
    <Dashboard />
  </MemoryRouter>
);

const renderPage = (): RenderResult => render(page() as unknown as ReactNode);

const queriesFor = (table: string) => queries.filter((q) => q.table === table);

beforeEach(() => {
  fromMock.mockReset();
  rows = {};
  counts = {};
  holdStores = false;
  installClient();
});

afterEach(() => {
  cleanup();
});

describe("Dashboard with an active business that has no mapped stores", () => {
  it("shows a clear empty state instead of a shell of zeroed KPIs", async () => {
    contextFor([]);

    renderPage();

    expect(await screen.findByText(EMPTY_STATE_TITLE)).toBeInTheDocument();
    // No KPI shell, no operational card.
    expect(kpiMock).not.toHaveBeenCalled();
    expect(storeHealthMock).not.toHaveBeenCalled();
    expect(syncHealthMock).not.toHaveBeenCalled();
    // And no operational read was issued anywhere: failing closed means no
    // query, not a query that happens to return nothing. (The one read the page
    // does make is the global stock-settings flag, which is not tenant data.)
    expect(queriesFor("orders")).toHaveLength(0);
    expect(queriesFor("products")).toHaveLength(0);
    expect(queriesFor("stores")).toHaveLength(0);
    expect(queries.every((q) => q.table === "app_settings")).toBe(true);
  });

  it("does not claim 'no stores' while the scope is still resolving", async () => {
    holdStores = true; // the active business's store list has not settled yet
    contextFor([{ woo_store_id: "s1" }]);

    renderPage();

    // The loading shell, not a false empty state.
    expect(screen.queryByText(EMPTY_STATE_TITLE)).toBeNull();
    expect(kpiMock).not.toHaveBeenCalled();
    expect(screen.getByText("Overview of your operations")).toBeInTheDocument();
  });

  it("does not claim 'no stores' before a business is active at all", async () => {
    // Business context still resolving: no active business to attribute an
    // empty store list to, so "this business has no stores" would be a claim
    // about nobody.
    contextFor([], null);

    renderPage();

    expect(screen.queryByText(EMPTY_STATE_TITLE)).toBeNull();
    expect(kpiMock).not.toHaveBeenCalled();
    expect(screen.getByText("Overview of your operations")).toBeInTheDocument();
  });

  it("renders the normal shell when the active business does have stores", async () => {
    rows = {
      stores: [{ id: "s1", name: "Store One", status: "connected" }],
      orders: [],
      products: [],
      order_items: [],
    };
    contextFor([{ woo_store_id: "s1" }]);

    renderPage();

    await waitFor(() => expect(kpiMock).toHaveBeenCalled());
    expect(screen.queryByText(EMPTY_STATE_TITLE)).toBeNull();
    // The KPIs that did load are the active business's: every orders read carries
    // the tenant predicate.
    const orderPredicates = queriesFor("orders").flatMap((q) =>
      q.calls.filter((c) => c.method === "in" && c.args[0] === "store_id").map((c) => c.args[1]),
    );
    expect(orderPredicates.length).toBeGreaterThan(0);
    expect(orderPredicates.every((ids) => JSON.stringify(ids) === JSON.stringify(["s1"]))).toBe(true);
  });
});
