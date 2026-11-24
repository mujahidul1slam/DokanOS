import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

// Focused coverage for the 2026-11-23 WooCommerce E2E D2/D7 UI findings:
// the detail sheet must READ the external status fields, WARN when the store
// cancelled an order DokanOS still treats as active, and render the local
// "new_order" status as the human label "New Order" (not the raw enum).

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(async () => ({ data: null, error: null })),
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1", email: "owner@example.com" } } })) },
  },
}));
vi.mock("@/hooks/useBusinessContext", () => ({ useBusinessContext: vi.fn() }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: vi.fn() }));

import { supabase } from "@/integrations/supabase/client";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import { usePermissions } from "@/hooks/usePermissions";
import OrderDetailSheet from "@/components/orders/OrderDetailSheet";

const fromMock = supabase.from as unknown as Mock;
const contextMock = useBusinessContext as unknown as Mock;
const permissionsMock = usePermissions as unknown as Mock;

let selectArgs: string[] = [];
let orderRow: Record<string, unknown> = {};

const resultFor = (table: string) => {
  const rows: Record<string, unknown[]> = {
    stores: [{ id: "s1", name: "Store One" }],
    order_items: [],
    order_payments: [],
    order_timeline: [],
    order_item_measurements: [],
    courier_shipments: [],
  };
  if (table === "orders") return { data: orderRow, error: null };
  return { data: rows[table] ?? [], error: null };
};

const installClient = () => {
  fromMock.mockImplementation((table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of [
      "select", "order", "in", "eq", "neq", "is", "not", "or", "gte", "lte", "gt", "lt",
      "limit", "range", "update", "insert", "delete", "upsert", "single", "maybeSingle",
    ]) {
      b[m] = vi.fn((...args: unknown[]) => {
        if (table === "orders" && m === "select") selectArgs.push(String(args[0]));
        return b;
      });
    }
    b.then = (onFulfilled: (value: unknown) => unknown) =>
      Promise.resolve(resultFor(table)).then(onFulfilled);
    return b;
  });
};

const baseOrder = (over: Record<string, unknown> = {}) => ({
  id: "o1",
  order_number: "1001",
  status: "processing",
  payment_status: "unpaid",
  payment_method: "cod",
  source: "online",
  subtotal: 500,
  discount: 0,
  shipping_cost: 0,
  total: 500,
  tax_amount: 0,
  amount_to_collect: 500,
  notes: null,
  consignment_id: null,
  tracking_status: null,
  created_at: "2026-10-26T02:00:00.000Z",
  customer_name: "Alice",
  customer_phone: "01700000000",
  customer_address: "Road 1",
  customer_email: "alice@example.com",
  customer_city: "Dhaka",
  fulfillment_type: "delivery",
  store_id: "s1",
  stores: { url: null, name: "Store One" },
  ...over,
});

const renderSheet = () => render(<OrderDetailSheet orderId="o1" open onOpenChange={vi.fn()} />);

describe("OrderDetailSheet Woo external-status safety (D2/D7)", () => {
  beforeEach(() => {
    fromMock.mockReset();
    selectArgs = [];
    permissionsMock.mockReturnValue({ can: () => true });
    contextMock.mockReturnValue({
      active: { id: "b1", name: "Business", currency: "BDT" },
      businesses: [], brands: [{ woo_store_id: "s1" }], activeBrand: null,
      myRole: "owner", rolesByBusiness: {}, loading: false, error: null,
      contextReady: true, setActive: vi.fn(), setActiveBrand: vi.fn(), refresh: vi.fn(),
      onboardingCompletedAt: null,
    });
    installClient();
  });
  afterEach(() => cleanup());

  it("the detail load SELECT actually requests the external status fields", async () => {
    orderRow = baseOrder();
    renderSheet();
    await waitFor(() => expect(screen.getAllByText("#1001").length).toBeGreaterThan(0));
    expect(selectArgs.length).toBeGreaterThan(0);
    for (const arg of selectArgs) {
      expect(arg).toContain("woocommerce_external_status");
      expect(arg).toContain("woocommerce_external_status_at");
      expect(arg).toContain("source");
    }
  });

  it("shows a visible warning when the store cancelled an order still active locally", async () => {
    orderRow = baseOrder({ status: "new_order", woocommerce_external_status: "cancelled" });
    renderSheet();
    await waitFor(() => expect(screen.getAllByText("#1001").length).toBeGreaterThan(0));
    expect(screen.getAllByText(/Status mismatch with the online store/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/do not dispatch/i).length).toBeGreaterThan(0);
    // The store status itself is also surfaced in the detail body.
    expect(screen.getAllByText(/Cancelled/i).length).toBeGreaterThan(0);
  });

  it("renders new_order as New Order, never the raw enum", async () => {
    orderRow = baseOrder({ status: "new_order" });
    renderSheet();
    await waitFor(() => expect(screen.getAllByText("#1001").length).toBeGreaterThan(0));
    expect(screen.getAllByText("New Order").length).toBeGreaterThan(0);
    expect(screen.queryByText(/^new_order$/)).toBeNull();
  });
});
