import { supabase } from "@/integrations/supabase/client";

/**
 * Result contract of the create_my_brand_store RPC (locked in plan 01-01;
 * migration 20261006121000). Types come from the regenerated
 * Database["public"]["Functions"] — the call below is typed against them.
 */
export interface CreateMyBrandStoreResult {
  store_id: string;
  brand_id: string;
  storefront_id: string;
  slug: string;
}

/**
 * Typed error carrying the RPC's Postgres message and error code
 * (e.g. the P0001 "FORBIDDEN: owner or admin role required" from the
 * server-side role assert). The UI renders `error.message` directly.
 */
export class CreateMyBrandStoreError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "CreateMyBrandStoreError";
    this.code = code;
  }
}

/**
 * Per-business memo (D-17 wrapper idempotency seam): the first successful
 * result for a business is returned forever after without a second RPC call,
 * and concurrent invokes share a single in-flight promise. The RPC's
 * server-side single-store cap backs this up; a failed call is NOT cached so
 * the user can correct the input and retry.
 */
const resolvedByBusiness = new Map<string, CreateMyBrandStoreResult>();
const inflightByBusiness = new Map<string, Promise<CreateMyBrandStoreResult>>();

/**
 * Invokes create_my_brand_store under the caller's own JWT (member JWT ->
 * RLS/RPC authorization; this wrapper performs NO authorization of its own —
 * the RPC re-asserts the UBA role server-side). Creation is RPC-only: no
 * direct inserts into stores/brands/user_store_access/storefronts exist
 * client-side (no member INSERT policy covers them).
 */
export function createMyBrandStore(
  businessId: string,
  name: string,
): Promise<CreateMyBrandStoreResult> {
  const cached = resolvedByBusiness.get(businessId);
  if (cached) {
    return Promise.resolve(cached);
  }

  const inflight = inflightByBusiness.get(businessId);
  if (inflight) {
    return inflight;
  }

  const call: Promise<CreateMyBrandStoreResult> = Promise.resolve(
    supabase
      .rpc("create_my_brand_store", { p_business_id: businessId, p_name: name })
      .then(({ data, error }) => {
        inflightByBusiness.delete(businessId);
        if (error) {
          throw new CreateMyBrandStoreError(error.message, error.code ?? undefined);
        }
        // Shape is guaranteed by the locked RPC contract; cast from Json.
        const result = data as unknown as CreateMyBrandStoreResult;
        resolvedByBusiness.set(businessId, result);
        return result;
      }),
  );

  inflightByBusiness.set(businessId, call);
  return call;
}
