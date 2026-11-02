import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// Module-mock the Supabase client (never instantiate the real one — env vars
// are absent under vitest). Pattern: src/test/invoiceHtml.test.ts.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn() },
}));

import { supabase } from "@/integrations/supabase/client";
import { generateStoreSlug } from "@/lib/slug";
import { createMyBrandStore, CreateMyBrandStoreError } from "@/lib/createMyBrandStore";

const rpcMock = supabase.rpc as unknown as Mock;

const rpcOk = (result: Record<string, string>) => ({ data: result, error: null });

const fullResult = {
  store_id: "s-1",
  brand_id: "b-1",
  storefront_id: "sf-1",
  slug: "my-shop",
};

describe("generateStoreSlug (create_my_brand_store parity)", () => {
  it("derives the slug like the RPC and truncates at 60, not 48", () => {
    expect(generateStoreSlug("My Shop!")).toBe("my-shop");
    expect(generateStoreSlug("a".repeat(70))).toHaveLength(60);
  });

  it("falls back to the deterministic literal 'store' for names with no ASCII alphanumerics", () => {
    expect(generateStoreSlug("দোকান")).toBe("store");
    expect(generateStoreSlug("")).toBe("store");
    expect(generateStoreSlug("a")).toBe("store");
  });
});

describe("createMyBrandStore wrapper", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("calls the RPC once with the typed args and returns the resolved result", async () => {
    rpcMock.mockResolvedValue(rpcOk(fullResult));

    const result = await createMyBrandStore("biz-1", "My Shop");

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("create_my_brand_store", {
      p_business_id: "biz-1",
      p_name: "My Shop",
    });
    expect(result).toEqual(fullResult);
  });

  it("is idempotent per business: repeated and concurrent invokes reuse the first result (one RPC call)", async () => {
    rpcMock.mockResolvedValue(rpcOk(fullResult));

    const first = await createMyBrandStore("biz-2", "My Shop");
    const second = await createMyBrandStore("biz-2", "My Shop Renamed");
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);

    // concurrent invokes for the same business share a single in-flight call
    const [a, b] = await Promise.all([
      createMyBrandStore("biz-3", "Shop"),
      createMyBrandStore("biz-3", "Shop"),
    ]);
    expect(rpcMock).toHaveBeenCalledTimes(2); // biz-3 added exactly one call
    expect(a).toEqual(b);

    // a different business id gets its own call
    rpcMock.mockResolvedValue(rpcOk({ ...fullResult, slug: "other" }));
    await createMyBrandStore("biz-4", "Other");
    expect(rpcMock).toHaveBeenCalledTimes(3);
  });

  it("surfaces RPC errors as a typed CreateMyBrandStoreError carrying the P0001 message", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: "FORBIDDEN: owner or admin role required",
        details: null,
        hint: null,
        code: "P0001",
      },
    });

    await expect(createMyBrandStore("biz-5", "Nope")).rejects.toMatchObject({
      name: "CreateMyBrandStoreError",
      message: "FORBIDDEN: owner or admin role required",
      code: "P0001",
    });
  });
});
