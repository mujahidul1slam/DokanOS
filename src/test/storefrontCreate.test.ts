import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_STOREFRONT_SETUP,
  type StorefrontSetupValues,
} from "@/components/storefront/storefrontSetup";
import type { CreateStorefrontInput } from "@/components/storefront/storefrontCreate";

// Task 14 gap fix (2026-11-01, chief ruling "(c) both"): the create pipeline's
// toast must tell the truth about the scaffold/publish outcome — it may never
// claim "starter pages were published" when the page writes were rejected.
// scaffoldStorefront is mocked here (its own error surfacing is pinned in
// storefrontScaffold.test.ts); storefronts/pages/sections runs are driven
// through a queue-based chainable builder mock.

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/storefront/lib/pages", () => ({ scaffoldStorefront: vi.fn() }));

import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { scaffoldStorefront } from "@/storefront/lib/pages";
import { createStorefrontFromForm } from "@/components/storefront/storefrontCreate";

type Result = { data?: unknown; error?: unknown };

const queues: Record<string, Result[]> = {};
const insertPayloads: Record<string, unknown[]> = {};

function push(table: string, ...results: Result[]) {
  (queues[table] ??= []).push(...results);
}

const input = (over: Partial<StorefrontSetupValues> = {}): CreateStorefrontInput => ({
  values: {
    ...DEFAULT_STOREFRONT_SETUP,
    name: "My Brand",
    slug: "my-brand",
    publishNow: true,
    ...over,
  },
  brandChoice: "brand-1",
  businessId: "biz-1",
  business: { currency: "BDT" },
  brands: [{ id: "brand-1", name: "Brand One", woo_store_id: "store-1" }],
  businessStoreIds: ["store-1"],
});

beforeEach(() => {
  for (const key of Object.keys(queues)) delete queues[key];
  for (const key of Object.keys(insertPayloads)) delete insertPayloads[key];
  vi.clearAllMocks();
  (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    const queue = queues[table] ?? [];
    const builder: {
      select: () => unknown;
      insert: (payload: unknown) => unknown;
      update: () => unknown;
      eq: () => unknown;
      order: () => unknown;
      single: () => unknown;
      maybeSingle: () => unknown;
      then: (resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) => Promise<unknown>;
    } = {
      select: () => builder,
      insert: (payload: unknown) => {
        (insertPayloads[table] ??= []).push(payload);
        return builder;
      },
      update: () => builder,
      eq: () => builder,
      order: () => builder,
      single: () => builder,
      maybeSingle: () => builder,
      then: (resolve, reject) =>
        Promise.resolve(queue.shift() ?? { data: null, error: null }).then(resolve, reject),
    };
    return builder;
  });
});

describe("createStorefrontFromForm — honest scaffold/publish toasts", () => {
  it("reports pages pending (never 'published') when scaffolding fails", async () => {
    vi.mocked(scaffoldStorefront).mockRejectedValue(new Error("rls"));
    push("storefronts", { data: { id: "sf-1", name: "My Brand", slug: "my-brand" }, error: null });

    const created = await createStorefrontFromForm(input());

    expect(created).toEqual({ id: "sf-1", name: "My Brand", slug: "my-brand" });
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Storefront created — starter pages pending",
        variant: "destructive",
        description: expect.stringContaining("could not be created"),
      }),
    );
    expect(toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining("were published") }),
    );
  });

  it("claims published only when the Home page was actually published", async () => {
    vi.mocked(scaffoldStorefront).mockResolvedValue(undefined);
    push("storefronts", { data: { id: "sf-1", name: "My Brand", slug: "my-brand" }, error: null });
    push("storefront_pages", { data: { id: "p1" }, error: null }, { error: null });
    push("storefront_page_sections", { data: [], error: null });

    await createStorefrontFromForm(input());

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Storefront created",
        description: expect.stringContaining("starter pages were published"),
      }),
    );
  });

  it("binds the brand on the storefront payload (the RLS fix's precondition)", async () => {
    vi.mocked(scaffoldStorefront).mockResolvedValue(undefined);
    push("storefronts", { data: { id: "sf-1", name: "My Brand", slug: "my-brand" }, error: null });
    push("storefront_pages", { data: { id: "p1" }, error: null }, { error: null });
    push("storefront_page_sections", { data: [], error: null });

    await createStorefrontFromForm(input());

    expect(insertPayloads.storefronts?.[0]).toMatchObject({
      brand_id: "brand-1",
      store_id: "store-1",
    });
  });

  it("reports pages pending when publish-now could not publish Home", async () => {
    vi.mocked(scaffoldStorefront).mockResolvedValue(undefined);
    push("storefronts", { data: { id: "sf-1", name: "My Brand", slug: "my-brand" }, error: null });
    push("storefront_pages", { data: { id: "p1" }, error: null }, { error: { message: "rls" } });
    push("storefront_page_sections", { data: [], error: null });

    await createStorefrontFromForm(input());

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Storefront created — starter pages pending",
        variant: "destructive",
        description: expect.stringContaining("Home is not published yet"),
      }),
    );
    expect(toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining("were published") }),
    );
  });

  it("reports pages pending when the Home page cannot be found at all", async () => {
    vi.mocked(scaffoldStorefront).mockResolvedValue(undefined);
    push("storefronts", { data: { id: "sf-1", name: "My Brand", slug: "my-brand" }, error: null });
    push("storefront_pages", { data: null, error: null });

    await createStorefrontFromForm(input());

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Storefront created — starter pages pending",
        variant: "destructive",
      }),
    );
  });

  it("keeps the honest draft message when publishing was not requested", async () => {
    vi.mocked(scaffoldStorefront).mockResolvedValue(undefined);
    push("storefronts", { data: { id: "sf-1", name: "My Brand", slug: "my-brand" }, error: null });

    await createStorefrontFromForm(input({ publishNow: false }));

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Storefront created",
        description: "Starter pages (Home, Contact) were created in draft.",
      }),
    );
  });
});
