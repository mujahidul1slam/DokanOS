import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// S2 seam test: switching business must persist the S1 server-side active
// business context (set_active_business_context) *before* the client tears down
// tenant-scoped state, and must fail closed when the server rejects the switch.
// The Supabase client and useAuth are module-mocked (precedent:
// src/test/useStoresList.test.tsx), so nothing here needs Docker or a database.

const { rpc, from, channel, removeChannel } = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  channel: vi.fn(),
  removeChannel: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc, from, channel, removeChannel },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { BusinessContextProvider, useBusinessContext } from "@/hooks/useBusinessContext";
import { useStoresListState } from "@/hooks/useStoresList";

const rpcMock = supabase.rpc as unknown as Mock;
const fromMock = supabase.from as unknown as Mock;
const channelMock = supabase.channel as unknown as Mock;
const authMock = useAuth as unknown as Mock;

const STORAGE_KEY = "dokanos-active-business-id"; // mirrors useBusinessContext
const USER_ID = "00000000-0000-0000-0000-0000000000ff";
const BIZ_ONE = "11111111-0000-0000-0000-000000000001";
const BIZ_TWO = "11111111-0000-0000-0000-000000000002";
const BIZ_NOT_MEMBER = "11111111-0000-0000-0000-000000000003";

const business = (id: string, name: string) => ({
  id,
  name,
  slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  logo_url: null,
  currency: "BDT",
  timezone: "Asia/Dhaka",
  address: null,
  email: null,
  phone: null,
  is_active: true,
});

/** The signed-in user belongs to both fixture businesses. */
const membershipRows = () => [
  { role: "owner", business_id: BIZ_ONE, businesses: business(BIZ_ONE, "Biz One") },
  { role: "member", business_id: BIZ_TWO, businesses: business(BIZ_TWO, "Biz Two") },
];

/** Ordered record of the calls the switch path makes, so the
 *  RPC-before-cache-teardown contract is asserted on real ordering. */
const callLog: string[] = [];

let tables: Record<string, Record<string, unknown>>;

/** Chainable supabase-js builder stand-in that resolves like the real one. */
const makeQuery = (result: Record<string, unknown>) => {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order"]) {
    builder[method] = vi.fn().mockReturnValue(builder);
  }
  builder.then = (onFulfilled: (value: Record<string, unknown>) => unknown) =>
    Promise.resolve(result).then(onFulfilled);
  return builder;
};

const channelStub = () => {
  const ch: Record<string, unknown> = {};
  ch.on = vi.fn().mockReturnValue(ch);
  ch.subscribe = vi.fn().mockReturnValue(ch);
  return ch;
};

// auth.users is absent under vitest, so the membership read is table-mocked.
const seedTables = () => {
  tables = {
    user_business_access: { data: membershipRows(), error: null },
    brands: { data: [], error: null },
    selling_points: { data: [], error: null, count: 0 },
    brand_stores: { data: [], error: null },
  };
};

const renderContext = () => {
  const queryClient = new QueryClient();
  const removeQueriesSpy = vi.spyOn(queryClient, "removeQueries").mockImplementation(() => {
    callLog.push("queryClient.removeQueries");
  });
  // This file is .ts (per the S2 test path), so the wrapper is built with
  // createElement rather than JSX.
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(BusinessContextProvider, null, children),
    );
  const rendered = renderHook(() => useBusinessContext(), { wrapper });
  return { ...rendered, removeQueriesSpy };
};

const switchTo = async (result: { current: { setActive: (id: string) => Promise<boolean> } }, id: string) => {
  let switched = false;
  await act(async () => {
    switched = await result.current.setActive(id);
  });
  return switched;
};

/**
 * Provider + the tenant read seam in one hook: the gating contract is asserted
 * on what the store scope actually does (fetch or fail closed), not on the
 * provider's internal state alone.
 */
const renderContextWithStoreScope = () => {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(BusinessContextProvider, null, children),
    );
  return renderHook(
    () => ({ ctx: useBusinessContext(), stores: useStoresListState() }),
    { wrapper },
  );
};

/** Calls the context value's table reads were recorded under, per table. */
const tableReads = (table: string) =>
  fromMock.mock.calls.filter((call: unknown[]) => call[0] === table);

describe("business switch persists the server-side active business context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    callLog.length = 0;
    seedTables();
    authMock.mockReturnValue({ user: { id: USER_ID } });
    fromMock.mockImplementation((table: string) => makeQuery(tables[table] ?? { data: [], error: null }));
    channelMock.mockReturnValue(channelStub());
    rpcMock.mockImplementation((fn: string) => {
      callLog.push(`rpc:${fn}`);
      return Promise.resolve({ data: BIZ_TWO, error: null });
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("writes the selected business id through the RPC before clearing tenant-scoped state", async () => {
    localStorage.setItem(STORAGE_KEY, BIZ_ONE);
    const { result, removeQueriesSpy } = renderContext();
    await waitFor(() => expect(result.current.businesses).toHaveLength(2));
    // Ignore mount-time work: the provider's login-path convergence already
    // wrote the persisted BIZ_ONE through the same RPC (see the convergence
    // describe block), so both the call log and the spy are re-baselined here
    // and the switch phase is measured on its own.
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("set_active_business_context", { p_business_id: BIZ_ONE });
    callLog.length = 0;
    rpcMock.mockClear();

    expect(await switchTo(result, BIZ_TWO)).toBe(true);

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("set_active_business_context", { p_business_id: BIZ_TWO });
    expect(removeQueriesSpy).toHaveBeenCalled();
    expect(callLog).toEqual(["rpc:set_active_business_context", "queryClient.removeQueries"]);
    // The client-side switch still completes on the happy path.
    expect(result.current.active?.id).toBe(BIZ_TWO);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(BIZ_TWO);
  });

  it("returns false and leaves the previous context intact when the RPC rejects the switch", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    // Only the switch to BIZ_TWO is rejected: the mount-time convergence for the
    // stored BIZ_ONE is a legitimate write and must not fail the render.
    rpcMock.mockImplementation((fn: string, args: { p_business_id: string }) => {
      callLog.push(`rpc:${fn}`);
      return args?.p_business_id === BIZ_TWO
        ? Promise.resolve({
            data: null,
            error: { message: "user is not an active member of the requested business", code: "42501" },
          })
        : Promise.resolve({ data: args?.p_business_id ?? null, error: null });
    });
    localStorage.setItem(STORAGE_KEY, BIZ_ONE);
    const { result, removeQueriesSpy } = renderContext();
    await waitFor(() => expect(result.current.businesses).toHaveLength(2));

    expect(await switchTo(result, BIZ_TWO)).toBe(false);

    expect(removeQueriesSpy).not.toHaveBeenCalled();
    expect(result.current.active?.id).toBe(BIZ_ONE);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(BIZ_ONE);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("active business context"),
      expect.anything(),
    );
  });

  it("does not call the RPC when the membership pre-check fails", async () => {
    localStorage.setItem(STORAGE_KEY, BIZ_ONE);
    const { result, removeQueriesSpy } = renderContext();
    await waitFor(() => expect(result.current.businesses).toHaveLength(2));
    // Mount-time login-path convergence wrote the persisted BIZ_ONE; the spy is
    // re-baselined so the assertion below covers the rejected switch only.
    expect(rpcMock).toHaveBeenCalledWith("set_active_business_context", { p_business_id: BIZ_ONE });
    rpcMock.mockClear();

    expect(await switchTo(result, BIZ_NOT_MEMBER)).toBe(false);

    expect(rpcMock).not.toHaveBeenCalled();
    expect(removeQueriesSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(BIZ_ONE);
  });

  it("abandons a switch whose membership was revoked since the last load (no server write)", async () => {
    localStorage.setItem(STORAGE_KEY, BIZ_ONE);
    const { result, removeQueriesSpy } = renderContext();
    await waitFor(() => expect(result.current.businesses).toHaveLength(2));
    // Mount-time login-path convergence wrote the persisted BIZ_ONE; the spy is
    // re-baselined so the assertion below covers the abandoned switch only.
    expect(rpcMock).toHaveBeenCalledWith("set_active_business_context", { p_business_id: BIZ_ONE });
    rpcMock.mockClear();

    // Revocation lands between renders: the authoritative read no longer lists BIZ_TWO.
    tables.user_business_access = { data: [membershipRows()[0]], error: null };

    expect(await switchTo(result, BIZ_TWO)).toBe(false);

    expect(rpcMock).not.toHaveBeenCalled();
    expect(removeQueriesSpy).not.toHaveBeenCalled();
    expect(result.current.active?.id).toBe(BIZ_ONE);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(BIZ_ONE);
  });
});

describe("login-path convergence persists the resolved active business server-side", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    callLog.length = 0;
    seedTables();
    authMock.mockReturnValue({ user: { id: USER_ID } });
    fromMock.mockImplementation((table: string) => makeQuery(tables[table] ?? { data: [], error: null }));
    channelMock.mockReturnValue(channelStub());
    rpcMock.mockImplementation((fn: string) => {
      callLog.push(`rpc:${fn}`);
      return Promise.resolve({ data: BIZ_ONE, error: null });
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("writes the first membership's business through the RPC when nothing is persisted yet", async () => {
    // A fresh login: the browser has no dokanos-active-business-id, so the
    // context resolves client-side and the server must be told about it.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    const { result } = renderContext();

    await waitFor(() => expect(result.current.businesses).toHaveLength(2));
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));

    expect(rpcMock).toHaveBeenCalledWith("set_active_business_context", { p_business_id: BIZ_ONE });
    expect(result.current.active?.id).toBe(BIZ_ONE);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(BIZ_ONE);
  });

  it("converges once per effective id instead of on every refresh (realtime storm)", async () => {
    localStorage.setItem(STORAGE_KEY, BIZ_ONE);
    const { result } = renderContext();
    await waitFor(() => expect(result.current.businesses).toHaveLength(2));
    // Mount-time convergence for the persisted choice has already happened.
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    expect(rpcMock).toHaveBeenCalledWith("set_active_business_context", { p_business_id: BIZ_ONE });

    // Realtime-triggered refreshes re-read memberships; the guard must stop them
    // from re-issuing the same server write.
    await act(async () => {
      await result.current.refresh();
      await result.current.refresh();
    });

    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});

describe("tenant-scoped reads stay gated until the server context converges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    callLog.length = 0;
    seedTables();
    // A brand-store link exists, so the stores read WOULD fire if it were not
    // gated on convergence — that is the observable this block asserts on.
    tables.brands = { data: [{ woo_store_id: "s1" }], error: null };
    authMock.mockReturnValue({ user: { id: USER_ID } });
    fromMock.mockImplementation((table: string) => makeQuery(tables[table] ?? { data: [], error: null }));
    channelMock.mockReturnValue(channelStub());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("issues no tenant read before the login-path context RPC has succeeded", async () => {
    localStorage.setItem(STORAGE_KEY, BIZ_ONE);
    let settleConvergence: (value: unknown) => void = () => {};
    rpcMock.mockImplementation((fn: string) => {
      callLog.push(`rpc:${fn}`);
      return new Promise((resolve) => {
        settleConvergence = resolve;
      });
    });

    const { result } = renderContextWithStoreScope();

    // The RPC is on the wire and has not settled yet.
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("set_active_business_context", { p_business_id: BIZ_ONE }),
    );
    expect(result.current.ctx.contextReady).toBe(false);
    expect(tableReads("stores")).toHaveLength(0);
    expect(result.current.stores.stores).toEqual([]);
    expect(result.current.stores.settled).toBe(false);

    await act(async () => {
      settleConvergence({ data: BIZ_ONE, error: null });
    });

    // Once the server context agrees with the client's choice, reads may flow.
    await waitFor(() => expect(result.current.ctx.contextReady).toBe(true));
    await waitFor(() => expect(tableReads("stores").length).toBeGreaterThan(0));
  });

  it("fails closed when the login-path convergence is rejected", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem(STORAGE_KEY, BIZ_ONE);
    rpcMock.mockImplementation((fn: string) => {
      callLog.push(`rpc:${fn}`);
      return Promise.resolve({
        data: null,
        error: { message: "could not persist active business", code: "PGRST002" },
      });
    });

    const { result } = renderContextWithStoreScope();

    await waitFor(() => expect(result.current.ctx.businesses).toHaveLength(2));
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    await act(async () => {});

    // The client selection must not become a tenant scope the server never
    // confirmed: no stores read, no published scope, and the gate stays shut
    // (an RPC error leaves the surface fail-closed, not silently unscoped).
    expect(result.current.ctx.contextReady).toBe(false);
    expect(tableReads("stores")).toHaveLength(0);
    expect(result.current.stores.stores).toEqual([]);
    expect(result.current.stores.settled).toBe(false);
  });
});
