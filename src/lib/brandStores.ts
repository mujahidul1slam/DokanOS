import { supabase } from "@/integrations/supabase/client";

/**
 * Issue #12: a store is an explicit physical outlet or online shop under
 * exactly one brand. There is deliberately no combined type. Creating one
 * requires only a name, parent brand and type; addresses, integrations and
 * storefront publication are separate later configuration.
 */
export const BRAND_STORE_TYPES = ["physical", "online"] as const;
export type BrandStoreType = (typeof BRAND_STORE_TYPES)[number];

export interface BrandStore {
  id: string;
  brand_id: string;
  name: string;
  store_type: BrandStoreType;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

export const isBrandStoreType = (value: unknown): value is BrandStoreType =>
  typeof value === "string" && (BRAND_STORE_TYPES as readonly string[]).includes(value);

export class BrandStoreError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "BrandStoreError";
    this.code = code;
  }
}

export interface CreateBrandStoreInput {
  brandId: string;
  name: string;
  storeType: BrandStoreType;
}

/**
 * Calls the authoritative RPC. The parent brand is the only account context
 * sent: the server derives and authorizes the business account from it.
 */
export async function createBrandStore(input: CreateBrandStoreInput): Promise<BrandStore> {
  const name = input.name.trim();
  if (name.length === 0 || name.length > 100) {
    throw new BrandStoreError("STORE_INVALID_NAME: store name must be 1-100 characters", "STORE_INVALID_NAME");
  }
  if (!isBrandStoreType(input.storeType)) {
    throw new BrandStoreError("STORE_INVALID_TYPE: store type must be physical or online", "STORE_INVALID_TYPE");
  }

  const { data, error } = await supabase.rpc("create_brand_store", {
    p_brand_id: input.brandId,
    p_name: name,
    p_store_type: input.storeType,
  });
  if (error) {
    throw new BrandStoreError(error.message, error.code ?? "STORE_CREATE_FAILED");
  }
  return data as unknown as BrandStore;
}
