import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { OnboardingStepProps } from "@/features/onboarding/stepProps";

// Task 14 gap (CSV import id space, found in the chief's UI verification
// 2026-11-01): the CSV import's target picker wrote `brand_stores` row ids
// into products.store_id — the WRONG id space (products.store_id is an
// operational `stores` id; RLS and the FK both reject brand_stores ids). The
// picker and payload must ride useStoresList (the Products page's operational
// space). These pins lock the id space of the import payload end-to-end and
// the empty-state CTA's destination.

// jsdom lacks the layout APIs Radix Select touches when opening.
window.HTMLElement.prototype.scrollIntoView ??= () => {};
window.HTMLElement.prototype.hasPointerCapture ??= () => false;
window.HTMLElement.prototype.releasePointerCapture ??= () => {};

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useBusinessContext", () => ({
  useBusinessContext: () => ({}),
}));
vi.mock("@/hooks/useStoresList", () => ({
  useStoresList: vi.fn(),
  useStoresListState: vi.fn(() => ({ stores: [], settled: true })),
  brandStoreIdsOf: vi.fn(() => []),
  storeScopeKey: vi.fn(() => ""),
}));

import { supabase } from "@/integrations/supabase/client";
import { useStoresList, type StoreLite } from "@/hooks/useStoresList";
import { ProductImportStep } from "@/features/onboarding/steps/ProductImportStep";

const insertPayloads: Record<string, unknown[]> = {};

beforeEach(() => {
  for (const key of Object.keys(insertPayloads)) delete insertPayloads[key];
  vi.clearAllMocks();
  (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    const builder: {
      select: () => unknown;
      insert: (payload: unknown) => unknown;
      update: () => unknown;
      delete: () => unknown;
      eq: () => unknown;
      in: () => unknown;
      order: () => unknown;
      single: () => unknown;
      maybeSingle: () => unknown;
      then: (
        resolve: (v: { data?: unknown; error?: unknown }) => unknown,
        reject?: (e: unknown) => unknown,
      ) => Promise<unknown>;
    } = {
      select: () => builder,
      insert: (payload: unknown) => {
        if (table === "products") {
          const rows = Array.isArray(payload) ? payload : [payload];
          (insertPayloads.products ??= []).push(...rows);
        }
        return builder;
      },
      update: () => builder,
      delete: () => builder,
      eq: () => builder,
      in: () => builder,
      order: () => builder,
      single: () => builder,
      maybeSingle: () => builder,
      then: (resolve, reject) =>
        Promise.resolve({ data: table === "order_sources" ? [] : null, error: null }).then(
          resolve,
          reject,
        ),
    };
    return builder;
  });
});

const props = (): OnboardingStepProps => ({
  business: {
    id: "biz-1",
    name: "Biz One",
    slug: "biz-one",
    logo_url: null,
    currency: "BDT",
    timezone: "Asia/Dhaka",
    address: null,
    email: null,
    phone: null,
    is_active: true,
  },
  businessId: "biz-1",
  brands: [
    {
      id: "brand-1",
      business_id: "biz-1",
      name: "Brand One",
      slug: "brand-one",
      logo_url: null,
      woo_store_id: "s-1",
      is_active: true,
    },
  ],
  onFinished: vi.fn(async () => true),
  onBack: undefined,
  onGoToStep: vi.fn(),
  onContextRefresh: vi.fn(),
});

const renderStep = (stores: StoreLite[]) => {
  vi.mocked(useStoresList).mockReturnValue(stores);
  return render(
    <MemoryRouter>
      <ProductImportStep {...props()} />
    </MemoryRouter>,
  );
};

/** Duck-typed upload: the handler only reads `.name` and `.text()`. */
const csvFile = (csv: string) =>
  ({ name: "products.csv", text: async () => csv }) as unknown as File;

describe("ProductImportStep — CSV import target id space", () => {
  it("imports into the operational store id, never a brand_stores id", async () => {
    renderStep([{ id: "s-1", name: "Outlet" }]);

    const input = document.getElementById("onboarding-csv-file") as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [csvFile("name,sku,price\nWidget,W-1,10\nGadget,G-1,20")] },
    });

    await screen.findByText(/rows ready to import/);
    fireEvent.click(screen.getByRole("button", { name: /Import 2 products/ }));

    await waitFor(() => expect(insertPayloads.products?.length).toBe(2));
    const payloads = insertPayloads.products as Array<{ store_id: string }>;
    expect(payloads.every((p) => p.store_id === "s-1")).toBe(true);
    expect(payloads.some((p) => p.store_id === "bs-1")).toBe(false);
  });

  it("lists only operational stores in the target picker", async () => {
    renderStep([
      { id: "s-1", name: "Outlet" },
      { id: "s-2", name: "Warehouse Shop" },
    ]);

    fireEvent.click(screen.getByRole("combobox"));
    await screen.findByRole("option", { name: "Outlet" });
    expect(screen.getByRole("option", { name: "Warehouse Shop" })).toBeTruthy();
    expect(screen.queryByText("Brand Store")).toBeNull();
  });

  it("points store-less businesses at Integrations (not the Brands page)", async () => {
    renderStep([]);

    expect(
      await screen.findByText(/Add a store on Integrations/),
    ).toBeTruthy();
    expect(screen.queryByText(/Add a store on the Brands page/)).toBeNull();
  });
});
