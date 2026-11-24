import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Regression for the money-losing defect found on live test order EE-8869-W on
// 2026-11-24: a WooCommerce order whose value sits in a FEE rather than in
// products imported as total 1.00, then read 0.00 after being opened and saved
// untouched. The sheet rebuilt subtotal/total from its (empty) item list.
// The saved row must keep the money unless the items were actually edited.

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
vi.mock("@/lib/auditLog", () => ({ logAction: vi.fn(async () => undefined) }));
vi.mock("@/lib/orderTimeline", () => ({ addOrderTimeline: vi.fn(async () => undefined) }));

import { supabase } from "@/integrations/supabase/client";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import { usePermissions } from "@/hooks/usePermissions";
import OrderDetailSheet from "@/components/orders/OrderDetailSheet";

const fromMock = supabase.from as unknown as Mock;
const contextMock = useBusinessContext as unknown as Mock;
const permissionsMock = usePermissions as unknown as Mock;

let orderRow: Record<string, unknown> = {};
let updates: Array<Record<string, unknown>> = [];

/** The main save is the update that carries subtotal/total. */
const savedTotals = () => updates.find((u) => "total" in u || "subtotal" in u) ?? null;

const installClient = () => {
  fromMock.mockImplementation((table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of [
      "select", "order", "in", "eq", "neq", "is", "not", "or", "gte", "lte", "gt", "lt",
      "limit", "range", "update", "insert", "delete", "upsert", "single", "maybeSingle",
    ]) {
      b[m] = vi.fn((...args: unknown[]) => {
        if (table === "orders" && m === "update") updates.push(args[0] as Record<string, unknown>);
        return b;
      });
    }
    b.then = (onFulfilled: (value: unknown) => unknown) => {
      const empty: Record<string, unknown[]> = {
        order_items: [],
        order_payments: [],
        order_timeline: [],
        order_item_measurements: [],
        courier_shipments: [],
        stores: [{ id: "s1", name: "Store One" }],
      };
      const value = table === "orders" ? { data: orderRow, error: null } : { data: empty[table] ?? [], error: null };
      return Promise.resolve(value).then(onFulfilled);
    };
    return b;
  });
};

// A fee-only order: money is real, but there are no line items to explain it.
const feeOnlyOrder = (over: Record<string, unknown> = {}) => ({
  id: "o1",
  order_number: "EE-8869-W",
  status: "processing",
  payment_status: "paid",
  payment_method: "cod",
  source: "woocommerce",
  subtotal: 1,
  discount: 0,
  shipping_cost: 0,
  total: 1,
  tax_amount: 0,
  amount_to_collect: 0,
  notes: null,
  consignment_id: null,
  tracking_status: null,
  created_at: "2026-11-24T15:46:00.000Z",
  customer_name: "DO NOT SHIP E2E Fixture2",
  customer_phone: "01700000001",
  customer_address: "Test address only",
  customer_email: "do-not-ship2@example.invalid",
  customer_city: "Dhaka",
  fulfillment_type: "delivery",
  store_id: "s1",
  stores: { url: null, name: "Store One" },
  ...over,
});

describe("OrderDetailSheet keeps money that is not in the line items", () => {
  beforeEach(() => {
    fromMock.mockReset();
    updates = [];
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

  it("saves total 1 for a fee-only order that was never edited", async () => {
    orderRow = feeOnlyOrder();
    render(<OrderDetailSheet orderId="o1" open onOpenChange={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByText(/#EE-8869-W/).length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => expect(savedTotals()).not.toBeNull());
    expect(savedTotals()?.total).toBe(1);
    expect(savedTotals()?.subtotal).toBe(1);
  });
});
