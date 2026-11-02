import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Task 15 page behavior: the pool renders empty (not broken) before/after the
// cutover migration, lists both entity kinds, and reassignment writes the
// script-shaped payload (brand binding + legacy provenance) behind the pool
// guard. The Supabase client and the business context are module-mocked
// (precedent: src/test/dashboardEmptyScopeState.test.tsx); the reassign dialog
// runs for real (it preselects the first brand and its first source).

vi.mock("@/hooks/useBusinessContext", () => ({
  useBusinessContext: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn() },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), info: vi.fn() },
}));

import { useBusinessContext } from "@/hooks/useBusinessContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import LegacyPool from "@/pages/LegacyPool";

const ctxMock = useBusinessContext as unknown as Mock;
const fromMock = supabase.from as unknown as Mock;
const toastSuccessMock = toast.success as unknown as Mock;

const BRAND = {
  id: "brand-1",
  business_id: "biz-1",
  name: "Vincent",
  slug: "vincent",
  logo_url: null,
  woo_store_id: "store-1",
  is_active: true,
};

type Method = "select" | "is" | "eq" | "or" | "order" | "limit" | "in" | "update";

interface RecordedCall {
  method: Method;
  args: unknown[];
}

interface QueryResult {
  data: unknown;
  count: number | null;
  error: { message: string } | null;
}

type Chain = {
  [M in Method]: (...args: unknown[]) => Chain;
} & {
  then: (
    onFulfilled?: (value: QueryResult) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
};

interface FakeState {
  counts: Record<string, number>;
  rows: Record<string, unknown[]>;
  updateResult: Array<{ id: string }>;
  queries: Array<{ table: string; calls: RecordedCall[] }>;
}

let state: FakeState;

function resolveFor(table: string, calls: RecordedCall[]): QueryResult {
  const isHeadCount = calls.some(
    (call) =>
      call.method === "select" &&
      typeof call.args[1] === "object" &&
      call.args[1] !== null &&
      (call.args[1] as { head?: boolean }).head === true,
  );
  if (isHeadCount) {
    return { data: null, count: state.counts[table] ?? 0, error: null };
  }
  if (calls.some((call) => call.method === "update")) {
    return { data: state.updateResult, count: null, error: null };
  }
  return { data: state.rows[table] ?? [], count: null, error: null };
}

function makeChain(table: string): Chain {
  const calls: RecordedCall[] = [];
  state.queries.push({ table, calls });
  const chain = {} as Chain;
  const methods: Method[] = ["select", "is", "eq", "or", "order", "limit", "in", "update"];
  for (const method of methods) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  chain.then = (onFulfilled, onRejected) =>
    Promise.resolve(resolveFor(table, calls)).then(onFulfilled, onRejected);
  return chain;
}

const POOL_ORDER = {
  id: "order-1",
  order_number: "3000",
  customer_name: "Test Customer One",
  customer_phone: "01711234567",
  total: 50,
  status: "pending",
  payment_status: "unpaid",
  created_at: "2026-10-30T10:00:00Z",
  source: "legacy migration",
  deleted_at: null,
};

const POOL_CUSTOMER = {
  id: "customer-1",
  name: "Pool Person",
  phone: "01811234567",
  email: "pool@example.com",
  city: "Dhaka",
  created_at: "2026-10-30T10:00:00Z",
  source: "legacy migration",
};

const SOURCE_ROW = {
  id: "source-1",
  name: "Main Showroom",
  type: "showroom",
  brand_id: BRAND.id,
};

function seedPool(): void {
  state.counts = { orders: 1, customers: 1 };
  state.rows = {
    orders: [POOL_ORDER],
    customers: [POOL_CUSTOMER],
    order_sources: [SOURCE_ROW],
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <LegacyPool />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state = {
    counts: { orders: 0, customers: 0 },
    rows: {},
    updateResult: [{ id: "order-1" }],
    queries: [],
  };
  ctxMock.mockReturnValue({
    active: { id: "biz-1", name: "Enveil Vincent", currency: "BDT" },
    businesses: [],
    brands: [BRAND],
    activeBrand: null,
    myRole: "owner",
    rolesByBusiness: {},
    loading: false,
    error: null,
    contextReady: true,
  });
  fromMock.mockImplementation((table: string) => makeChain(table));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LegacyPool page", () => {
  it("renders the empty state when nothing is tagged (pre-migration / drained pool)", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText("The legacy pool is empty")).toBeTruthy(),
    );
    expect(screen.queryAllByRole("button", { name: "Reassign" })).toHaveLength(0);
  });

  it("lists pool orders and customers with counts", async () => {
    seedPool();
    renderPage();
    await waitFor(() => expect(screen.getByText("#3000")).toBeTruthy());
    expect(screen.getByText("Pool Person")).toBeTruthy();
    expect(screen.getByText("1 orders")).toBeTruthy();
    expect(screen.getByText("1 customers")).toBeTruthy();
  });

  it("reassigns an order through the pool guard with the brand + legacy payload", async () => {
    state.counts = { orders: 1, customers: 0 };
    state.rows = {
      orders: [POOL_ORDER],
      order_sources: [SOURCE_ROW],
    };
    renderPage();
    await waitFor(() => expect(screen.getByText("#3000")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Reassign" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Order #3000/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Reassign" }));
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalled());

    const updateQuery = state.queries.find(
      (query) =>
        query.table === "orders" &&
        query.calls.some((call) => call.method === "update"),
    );
    expect(updateQuery).toBeTruthy();
    const updateCall = updateQuery?.calls.find((call) => call.method === "update");
    expect(updateCall?.args[0]).toEqual({
      order_source_id: "source-1",
      store_id: "store-1",
    });

    // The pool guard rides on the UPDATE: id + the three binding NULLs
    // (structural pool membership under the key model).
    const guardCalls = (updateQuery?.calls ?? []).map((call) => [
      call.method,
      call.args[0],
      call.args[1],
    ]);
    expect(guardCalls).toEqual(
      expect.arrayContaining([
        ["eq", "id", "order-1"],
        ["is", "store_id", null],
        ["is", "storefront_id", null],
        ["is", "order_source_id", null],
      ]),
    );
  });

  it("reassigns a customer with origin_kind kept as legacy", async () => {
    state.counts = { orders: 0, customers: 1 };
    state.rows = {
      customers: [POOL_CUSTOMER],
      order_sources: [SOURCE_ROW],
    };
    renderPage();
    await waitFor(() => expect(screen.getByText("Pool Person")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Reassign" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reassign" }));
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalled());

    const updateQuery = state.queries.find(
      (query) =>
        query.table === "customers" &&
        query.calls.some((call) => call.method === "update"),
    );
    const updateCall = updateQuery?.calls.find((call) => call.method === "update");
    expect(updateCall?.args[0]).toEqual({
      origin_order_source_id: "source-1",
      origin_kind: "legacy",
      store_id: "store-1",
    });
  });

  it("hides reassignment from read-only staff", async () => {
    ctxMock.mockReturnValue({
      active: { id: "biz-1", name: "Enveil Vincent", currency: "BDT" },
      businesses: [],
      brands: [BRAND],
      activeBrand: null,
      myRole: "staff",
      rolesByBusiness: {},
      loading: false,
      error: null,
      contextReady: true,
    });
    state.counts = { orders: 1, customers: 0 };
    state.rows = { orders: [POOL_ORDER], order_sources: [SOURCE_ROW] };
    renderPage();
    await waitFor(() => expect(screen.getByText("#3000")).toBeTruthy());
    expect(screen.queryAllByRole("button", { name: "Reassign" })).toHaveLength(0);
  });
});
