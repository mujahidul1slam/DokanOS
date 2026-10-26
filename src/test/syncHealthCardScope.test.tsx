import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

// Hybrid tenancy (issue #16): SyncHealthCard read `sync_health` with no scope at
// all. `sync_health` is a GLOBAL, deployment-wide view (single row of aggregate
// counts, no store_id / business_id column — see
// supabase/migrations/20260903000300_sync_health_view.sql), so there is no
// tenant predicate to apply to it, and the card now says so in code. What the
// view DOES expose is per-store identity (`stores_sync[].name`,
// `breaker_detail[].name`, aggregated over every store in the deployment), so
// those two fields are redacted against the active business's stores, and the
// card fails closed entirely when the active business has no mapped stores.
//
// The Supabase client and the business context are module-mocked (precedent:
// src/test/appSidebarCategoryScope.test.tsx); the scope seam runs for real.

vi.mock("@/hooks/useBusinessContext", () => ({
  useBusinessContext: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn() },
}));

import { useBusinessContext } from "@/hooks/useBusinessContext";
import { supabase } from "@/integrations/supabase/client";
import SyncHealthCard from "@/components/dashboard/SyncHealthCard";

const ctxMock = useBusinessContext as unknown as Mock;
const fromMock = supabase.from as unknown as Mock;

type Query = { table: string; calls: Array<{ method: string; args: unknown[] }> };
let queries: Query[] = [];
let storeRows: Array<{ id: string; name: string; status: string }> = [];

/** The deployment-wide row, naming a store of ANOTHER business. */
const HEALTH_ROW = {
  queue_pending: 3,
  queue_processing: 5,
  queue_failed: 0,
  queue_dead_letter: 0,
  oldest_pending_seconds: 12,
  pending_waiting_retry: 0,
  stores_breaker_tripped: 1,
  breaker_detail: [{ name: "Store Nine", until: "2026-10-26T03:00:00.000Z" }],
  stores_sync: [
    { name: "Store One", status: "connected", last_synced_at: null, sync_age_minutes: 30 },
    { name: "Store Nine", status: "connected", last_synced_at: null, sync_age_minutes: 30 },
  ],
  courier_tracking: { pathao: { active: 4, stalest_tracked_minutes: 5 } },
  webhooks_last_hour: 10,
  webhooks_failed_last_hour: 0,
};

/** Chainable query-builder mock that records every predicate applied to it. */
const makeBuilder = (query: Query, data: unknown) => {
  const b: Record<string, unknown> = {};
  for (const method of ["select", "order", "in", "eq", "maybeSingle"]) {
    b[method] = vi.fn((...args: unknown[]) => {
      query.calls.push({ method, args });
      return b;
    });
  }
  b.then = (onFulfilled: (v: { data: unknown; error: null }) => unknown) =>
    Promise.resolve({ data, error: null }).then(onFulfilled);
  return b;
};

const installClient = () => {
  queries = [];
  fromMock.mockImplementation((table: string) => {
    const query: Query = { table, calls: [] };
    queries.push(query);
    return makeBuilder(query, table === "sync_health" ? HEALTH_ROW : storeRows);
  });
};

const contextFor = (brands: Array<{ woo_store_id: string | null }>, activeId: string | null = "b1") =>
  ctxMock.mockReturnValue({ brands, active: activeId ? { id: activeId } : null, loading: false, contextReady: true });

const queriesFor = (table: string) => queries.filter((q) => q.table === table);

beforeEach(() => {
  fromMock.mockReset();
  storeRows = [];
  installClient();
});

afterEach(() => {
  cleanup();
});

describe("SyncHealthCard and the global sync_health view", () => {
  it("reads the global view without a tenant predicate, and redacts other businesses' stores", async () => {
    storeRows = [{ id: "s1", name: "Store One", status: "connected" }];
    contextFor([{ woo_store_id: "s1" }]);

    render(<SyncHealthCard />);

    await waitFor(() => expect(queriesFor("sync_health")).toHaveLength(1));
    // Documented as global in src/components/dashboard/SyncHealthCard.tsx: the
    // view has no store_id column, so the read is a plain select + maybeSingle
    // and NOT a tenant-scoped query. That is why the tenant guarantee here comes
    // from the redaction below rather than from a predicate.
    expect(queriesFor("sync_health")[0].calls.map((c) => c.method)).toEqual(["select", "maybeSingle"]);

    // Only the active business's store is named on screen...
    expect(await screen.findByText(/Store One/)).toBeInTheDocument();
    expect(screen.queryByText(/Store Nine/)).toBeNull();
    // ...so the deployment-wide breaker of the other business is not attributed
    // to this business either.
    expect(screen.queryByText(/breaker\(s\) tripped/)).toBeNull();
    // The freshness tile counts THIS business's stores (one), not the two the
    // global view returned.
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("fails closed when the active business has no mapped stores: no read at all", async () => {
    storeRows = [];
    contextFor([]);

    const { container } = render(<SyncHealthCard />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("stops reading and clears the card when the active business loses its stores", async () => {
    storeRows = [{ id: "s1", name: "Store One", status: "connected" }];
    contextFor([{ woo_store_id: "s1" }]);

    const view = render(<SyncHealthCard />);
    expect(await screen.findByText(/Store One/)).toBeInTheDocument();

    const readsBeforeSwitch = queries.length;
    // Switch to a business with no mapped stores.
    contextFor([]);
    view.rerender(<SyncHealthCard />);

    await waitFor(() => expect(screen.queryByText(/Store One/)).toBeNull());
    expect(queriesFor("sync_health").every((q) => queries.indexOf(q) < readsBeforeSwitch)).toBe(true);
  });
});
