import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn() },
}));

import { supabase } from "@/integrations/supabase/client";
import {
  BRAND_STORE_TYPES,
  BrandStoreError,
  createBrandStore,
  isBrandStoreType,
} from "@/lib/brandStores";

const rpcMock = supabase.rpc as unknown as Mock;

const created = {
  id: "77777777-0000-0000-0000-000000000001",
  brand_id: "44444444-0000-0000-0000-000000000001",
  name: "Dhanmondi Outlet",
  store_type: "physical",
  is_published: false,
  created_at: "2026-10-19T00:00:00Z",
  updated_at: "2026-10-19T00:00:00Z",
};

describe("brand store types", () => {
  it("offers exactly the two explicit store types and no combined type", () => {
    expect(BRAND_STORE_TYPES).toEqual(["physical", "online"]);
    expect(isBrandStoreType("physical")).toBe(true);
    expect(isBrandStoreType("online")).toBe(true);
    for (const value of ["both", "physical_online", "hybrid", "ONLINE", "", null, undefined]) {
      expect(isBrandStoreType(value)).toBe(false);
    }
  });
});

describe("createBrandStore", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("sends only the name, parent brand and explicit type to the server RPC", async () => {
    rpcMock.mockResolvedValue({ data: created, error: null });

    const result = await createBrandStore({
      brandId: created.brand_id,
      name: "  Dhanmondi Outlet  ",
      storeType: "physical",
    });

    expect(result).toEqual(created);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("create_brand_store", {
      p_brand_id: created.brand_id,
      p_name: "Dhanmondi Outlet",
      p_store_type: "physical",
    });
  });

  it("rejects a combined or unknown store type before calling the server", async () => {
    for (const storeType of ["both", "physical_online", "hybrid"]) {
      await expect(
        createBrandStore({
          brandId: created.brand_id,
          name: "Combined Shop",
          storeType: storeType as never,
        }),
      ).rejects.toMatchObject({ name: "BrandStoreError", code: "STORE_INVALID_TYPE" });
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a blank name before calling the server", async () => {
    await expect(
      createBrandStore({ brandId: created.brand_id, name: "   ", storeType: "online" }),
    ).rejects.toMatchObject({ name: "BrandStoreError", code: "STORE_INVALID_NAME" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("surfaces backend denial details instead of reporting success", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: "FORBIDDEN: account owner or member role required",
        details: null,
        hint: null,
        code: "42501",
      },
    });

    await expect(
      createBrandStore({ brandId: created.brand_id, name: "Nope", storeType: "online" }),
    ).rejects.toMatchObject({
      name: "BrandStoreError",
      message: "FORBIDDEN: account owner or member role required",
      code: "42501",
    });
    expect(BrandStoreError).toBeDefined();
  });
});
