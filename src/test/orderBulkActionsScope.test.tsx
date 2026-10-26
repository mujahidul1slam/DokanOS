import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

// Hybrid tenancy (issue #16): the Orders page's bulk actions.
//
// A bulk action derives its ids from the page's (already scoped) order list, so
// every read it issues — the storefront re-read in Bulk Cancel, the payment
// sums behind Mark Paid — must be bounded by the ACTIVE business's stores, and
// an id that belongs to another business must never enter a read or a write
// (issue #16: child rows must not be able to reintroduce a foreign row).
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

// The Woo mirror and the slip printer issue their own reads; they are not the
// subject here, and mocking them keeps the recorded queries to the hook's own.
vi.mock("@/lib/wooNotes", () => ({
  postWooOrderNote: vi.fn(async () => {}),
  kickSyncWorker: vi.fn(async () => {}),
}));

vi.mock("@/components/orders/MeasurementSlipPrint", () => ({
  printMeasurementSlipsBulk: vi.fn(async () => ({ printed: 1, skipped: 0 })),
}));

import { supabase } from "@/integrations/supabase/client";
import { printMeasurementSlipsBulk } from "@/components/orders/MeasurementSlipPrint";
import { useOrderBulkActions } from "@/pages/orders/useOrderBulkActions";

const fromMock = supabase.from as unknown as Mock;
const invokeMock = supabase.functions.invoke as unknown as Mock;
const slipsMock = printMeasurementSlipsBulk as unknown as Mock;

const BIZ_ONE_STORES = ["s1", "s2"];

type Query = { table: string; calls: Array<{ method: string; args: unknown[] }> };

let queries: Query[] = [];
let since = 0;

const mark = () => {
  since = fromMock.mock.calls.length;
  queries = [];
};

const queriesFor = (table: string) => queries.filter((q) => q.table === table);

const argsFor = (table: string, method: string) =>
  queriesFor(table).flatMap((q) => q.calls.filter((c) => c.method === method).map((c) => c.args));

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
  b.single = vi.fn(() => b);
  b.maybeSingle = vi.fn(() => b);
  b.then = (onFulfilled: (value: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null, count: 0 }).then(onFulfilled);
  return b;
};

const installClient = () => {
  fromMock.mockImplementation((table: string) => {
    const query: Query = { table, calls: [] };
    queries.push(query);
    return makeBuilder(query);
  });
};

/** An order of the active business (store s1) and one of another (store s9). */
const inScopeOrder = { id: "o1", order_number: "1001", total: 500, consignment_id: "c1", woo_order_id: null, store_id: "s1" };
const foreignOrder = { id: "o9", order_number: "9001", total: 700, consignment_id: "c9", woo_order_id: null, store_id: "s9" };

const params = (over: Partial<Parameters<typeof useOrderBulkActions>[0]> = {}) => ({
  orders: [inScopeOrder, foreignOrder],
  selected: new Set<string>(),
  setSelected: vi.fn(),
  setBulkUpdating: vi.fn(),
  loadOrders: vi.fn(),
  toast: vi.fn(),
  duePayContext: { ids: [], totalDue: 0 },
  setDuePayContext: vi.fn(),
  setDuePayOpen: vi.fn(),
  businessStoreIds: BIZ_ONE_STORES,
  ...over,
});

describe("useOrderBulkActions scopes every bulk read to the active business's stores", () => {
  beforeEach(() => {
    fromMock.mockReset();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ data: null, error: null });
    slipsMock.mockClear();
    installClient();
    mark();
  });

  afterEach(() => {
    cleanup();
  });

  it("bounds the Bulk Cancel storefront re-read by the scope, and cancels only in-scope orders", async () => {
    const p = params({ selected: new Set(["o1", "o9"]) });
    const { result } = renderHook(() => useOrderBulkActions(p));

    await act(async () => {
      await result.current.handleBulkCancel();
    });

    // The re-read of storefront orders carries the tenant predicate.
    expect(argsFor("orders", "in")).toContainEqual(["store_id", BIZ_ONE_STORES]);
    // The foreign order never enters the read, nor the status write.
    expect(argsFor("orders", "in")).toContainEqual(["id", ["o1"]]);
    expect(argsFor("orders", "in")).not.toContainEqual(["id", ["o1", "o9"]]);
  });

  it("sums payments of the in-scope selection only, so a foreign order can never be marked paid", async () => {
    const setDuePayContext = vi.fn();
    const setDuePayOpen = vi.fn();
    const p = params({ selected: new Set(["o1", "o9"]), setDuePayContext, setDuePayOpen });
    const { result } = renderHook(() => useOrderBulkActions(p));

    await act(async () => {
      await result.current.handleBulkMarkPaid();
    });

    expect(argsFor("order_payments", "in")).toEqual([["order_id", ["o1"]]]);
    expect(setDuePayContext).toHaveBeenCalledWith({ ids: ["o1"], totalDue: 500 });
    expect(setDuePayOpen).toHaveBeenCalledWith(true);
  });

  it("fails closed when the active business has no stores: no read, no write", async () => {
    const setSelected = vi.fn();
    const setBulkUpdating = vi.fn();
    const setDuePayContext = vi.fn();
    const p = params({
      selected: new Set(["o1"]),
      businessStoreIds: [],
      setSelected,
      setBulkUpdating,
      setDuePayContext,
    });
    const { result } = renderHook(() => useOrderBulkActions(p));

    await act(async () => {
      await result.current.handleBulkCancel();
    });
    await act(async () => {
      await result.current.handleBulkMarkPaid();
    });
    await act(async () => {
      await result.current.handleTrashOrders(["o1"]);
    });
    await act(async () => {
      await result.current.handleRestoreOrders(["o1"]);
    });

    expect(fromMock.mock.calls.length).toBe(since);
    expect(setDuePayContext).not.toHaveBeenCalled();
    expect(setBulkUpdating).not.toHaveBeenCalled();
    expect(setSelected).not.toHaveBeenCalled();
  });

  it("fails closed when the whole selection belongs to another business", async () => {
    const toast = vi.fn();
    const setSelected = vi.fn();
    const p = params({ orders: [foreignOrder], selected: new Set(["o9"]), toast, setSelected });
    const { result } = renderHook(() => useOrderBulkActions(p));

    await act(async () => {
      await result.current.handleBulkStatusChange("shipped");
    });

    expect(fromMock.mock.calls.length).toBe(since);
    expect(setSelected).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("trashes and restores only the active business's orders", async () => {
    const p = params();
    const { result } = renderHook(() => useOrderBulkActions(p));

    await act(async () => {
      await result.current.handleTrashOrders(["o1", "o9"]);
    });
    expect(argsFor("orders", "in")).toContainEqual(["id", ["o1"]]);
    expect(argsFor("orders", "in")).not.toContainEqual(["id", ["o1", "o9"]]);

    mark();
    await act(async () => {
      await result.current.handleRestoreOrders(["o1", "o9"]);
    });
    expect(argsFor("orders", "in")).toContainEqual(["id", ["o1"]]);
    expect(argsFor("orders", "in")).not.toContainEqual(["id", ["o1", "o9"]]);
  });

  it("prints measurement slips and tracks parcels of the active business's orders only", async () => {
    const p = params({ selected: new Set(["o1", "o9"]) });
    const { result } = renderHook(() => useOrderBulkActions(p));

    await act(async () => {
      await result.current.handleBulkPrintMeasurementSlips();
    });
    expect(slipsMock).toHaveBeenCalledWith(["o1"]);

    mark();
    invokeMock.mockClear();
    await act(async () => {
      await result.current.handleBulkTrackSelected();
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0][1]).toMatchObject({
      body: { action: "track_order", consignment_id: "c1" },
    });
  });
});
