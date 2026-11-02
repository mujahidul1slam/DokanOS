import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

// Hybrid tenancy (issue #16): `pendingLoads` is the hook's "every query for the
// current scope has settled" signal — a caller that must observe a COMPLETE
// sweep (a switch, or a test asserting that no further query follows) waits for
// it to reach zero. Its accounting has to be symmetric: every started sweep
// releases exactly one count, on EVERY exit path, and a path that never took a
// count never releases one.
//
// The Supabase client is module-mocked (precedent: src/test/dashboardTenantScope.test.tsx).

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn() },
}));

vi.mock("@/lib/stockSettings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stockSettings")>();
  return { ...actual, useGlobalStockEnabled: vi.fn(() => true) };
});

import { supabase } from "@/integrations/supabase/client";
import { useGlobalStockEnabled } from "@/lib/stockSettings";
import { useDashboardData } from "@/hooks/useDashboardData";

const fromMock = supabase.from as unknown as Mock;
const stockEnabledMock = useGlobalStockEnabled as unknown as Mock;

const BIZ_ONE_STORES = ["s1", "s2"];
const BIZ_TWO_STORES = ["s9"];
const NO_SCOPE: string[] = [];

type Query = { table: string; calls: Array<{ method: string; args: unknown[] }> };
type Pending = { resolve: (value: { data: unknown[]; error: null; count: number }) => void };

let deferred: Pending[] = [];

/** A builder whose await is resolved by the test, so responses can be ordered. */
const makeDeferredBuilder = (query: Query) => {
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
  b.then = (onFulfilled: (value: { data: unknown[]; error: null; count: number }) => unknown) =>
    new Promise<{ data: unknown[]; error: null; count: number }>((resolve) => {
      deferred.push({ resolve });
    }).then(onFulfilled);
  return b;
};

/**
 * Releases every outstanding query — including the ones a sweep issues as it
 * proceeds — until no sweep is pending, or `rounds` is exhausted (so a leaked
 * count fails the assertion below instead of hanging the test).
 */
const drain = async (result: { current: { pendingLoads: number } }) => {
  for (let round = 0; round < 20 && result.current.pendingLoads > 0; round += 1) {
    let released = 0;
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      while (released < deferred.length) {
        deferred[released].resolve({ data: [], error: null, count: 0 });
        released += 1;
      }
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
    if (released === 0) break;
  }
};

beforeEach(() => {
  fromMock.mockReset();
  stockEnabledMock.mockReturnValue(true);
  deferred = [];
  fromMock.mockImplementation((table: string) => makeDeferredBuilder({ table, calls: [] }));
});

afterEach(() => {
  cleanup();
});

describe("useDashboardData pendingLoads accounting", () => {
  it("releases the count of a sweep that a business switch superseded", async () => {
    const { result, rerender } = renderHook(
      ({ scope }: { scope: string[] }) => useDashboardData("today", undefined, "all", scope),
      { initialProps: { scope: BIZ_ONE_STORES } },
    );

    await waitFor(() => expect(result.current.pendingLoads).toBe(1));
    expect(deferred.length).toBe(5); // 3 orders + 2 products round trips

    // Switch while business one's sweep is still in flight: its responses will
    // arrive after the switch and be discarded — but the count it took is a
    // count it must still hand back.
    rerender({ scope: BIZ_TWO_STORES });
    await waitFor(() => expect(result.current.pendingLoads).toBe(2));

    await drain(result);

    // A stale response that is DISCARDED must still release its load, otherwise
    // pendingLoads never reaches zero and a caller waits forever for a scope
    // that has long since settled.
    expect(result.current.pendingLoads).toBe(0);
  });

  it("does not release a count it never took when it fails closed", async () => {
    const { result, rerender } = renderHook(
      ({ scope }: { scope: string[] }) => useDashboardData("today", undefined, "all", scope),
      { initialProps: { scope: BIZ_ONE_STORES } },
    );

    await waitFor(() => expect(result.current.pendingLoads).toBe(1));

    // The active business loses its store scope while business one's sweep is
    // still in flight (a switch to a business with no mapped stores). The
    // fail-closed path starts no query of its own.
    rerender({ scope: NO_SCOPE });
    await act(async () => {
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });

    // Business one's sweep is STILL in flight, so its count must survive: a
    // fail-closed path that releases a count it never took makes
    // "pendingLoads === 0" lie about a scope that has not settled.
    expect(result.current.pendingLoads).toBe(1);
    expect(result.current.orders).toEqual([]); // the fail-closed state still applied

    // ...and the genuine release still happens when that sweep really settles.
    await drain(result);
    expect(result.current.pendingLoads).toBe(0);
  });
});
