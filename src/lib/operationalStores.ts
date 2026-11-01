import { supabase } from "@/integrations/supabase/client";

/**
 * Operational-store provisioning (option B, 2026-11-01 user decision).
 *
 * The app's operational store scope (`useStoresList` → `brands.woo_store_id` →
 * the legacy `stores` table) never received rows from the UI, so fresh
 * businesses saw "No stores in this business" and could not CSV/manual-add
 * products (`products.store_id` FK → `stores`, INSERT gated by
 * `user_can_access_store()`). This module provisions those rows from the two
 * places a merchant actually names a store:
 *
 *   1. a WooCommerce order-source connection (bridgeWooSourceToStore) — the
 *      source's name/URL/consumer credentials are copied onto the store row so
 *      the legacy sync workers (which read `stores`) can use them, and
 *      `order_sources.legacy_woo_store_id` records the provenance;
 *   2. an explicit "Add a local store" action for pure-CSV/manual merchants
 *      (provisionOperationalStore with a `local://` URL).
 *
 * Link-when-free: the fresh store is linked to the brand (`brands.woo_store_id`)
 * only while the brand has no link yet. A brand that already owns a store keeps
 * it (the UNIQUE index `idx_brands_woo_store_id_unique` also forbids sharing a
 * store between brands); the new row is still recorded on the source so the
 * legacy sync can find it. `user_can_access_store()` (20261026120000) gates on
 * exactly this link + user_business_access membership + the SELECTED active
 * business — it does NOT consult `user_store_access` (dropped from the gate in
 * 20261026120000; `usePermissions` treats an empty grant set as unrestricted),
 * so no grant rows are provisioned.
 */

export interface ProvisionOperationalStoreParams {
  brandId: string;
  name: string;
  url: string;
  /** stores.status — keep `local://` rows 'disconnected' so no sync ever picks them up. */
  status: string;
  consumerKey?: string;
  consumerSecret?: string;
}

export interface ProvisionOperationalStoreResult {
  storeId: string;
  /** True when this call linked the brand to the store (link-when-free). */
  linked: boolean;
}

/** `local://…` marks an offline (CSV/manual-only) store space — never syncable. */
export function isLocalStoreUrl(url: string | null | undefined): boolean {
  return /^local:\/\//i.test((url ?? "").trim());
}

/** Only http(s) store URLs may ever reach a sync worker. */
export function isSyncableStoreUrl(url: string | null | undefined): boolean {
  return /^https?:\/\//i.test((url ?? "").trim());
}

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "store";

/** URL for a local-only store space, e.g. `local://acme-brand`. */
export function localStoreUrl(brandName: string): string {
  return `local://${slugify(brandName)}`;
}

/**
 * Create one operational `stores` row and link it to the brand when the brand
 * has no store link yet. Throws on failure; the caller decides fail-soft.
 */
export async function provisionOperationalStore(
  params: ProvisionOperationalStoreParams,
): Promise<ProvisionOperationalStoreResult> {
  const name = params.name.trim();
  const url = params.url.trim();
  if (!name) throw new Error("Store name is required.");
  if (!url) throw new Error("Store URL is required.");
  if (!params.brandId) throw new Error("A store space lives under a brand — no brand to attach it to.");

  // Read the brand first so a bad brandId fails before any row is written.
  const { data: brand, error: brandError } = await supabase
    .from("brands")
    .select("id, woo_store_id")
    .eq("id", params.brandId)
    .maybeSingle();
  if (brandError) throw new Error(`Could not read the brand: ${brandError.message}`);
  if (!brand) throw new Error("Brand not found or not accessible.");

  const { data: store, error: storeError } = await supabase
    .from("stores")
    .insert({
      name,
      url,
      status: params.status,
      ...(params.consumerKey ? { consumer_key: params.consumerKey } : {}),
      ...(params.consumerSecret ? { consumer_secret: params.consumerSecret } : {}),
    })
    .select("id")
    .single();
  if (storeError) throw new Error(`Could not create the store space: ${storeError.message}`);
  const storeId = store.id;

  if (brand.woo_store_id) {
    // Keep the existing link (link-when-free); the new row is still useful as
    // the source's legacy sync record.
    return { storeId, linked: false };
  }

  // Guarded link: only while the brand is still free. Zero matched rows means
  // someone else linked first (or the brand slipped away) — keep whatever won.
  const { data: linked, error: linkError } = await supabase
    .from("brands")
    .update({ woo_store_id: storeId })
    .eq("id", params.brandId)
    .is("woo_store_id", null)
    .select("id");
  if (linkError) {
    throw new Error(
      `Store space created but not linked to ${name}'s brand: ${linkError.message} — product pickers will not see it.`,
    );
  }
  return { storeId, linked: (linked ?? []).length > 0 };
}

export interface BridgeWooSourceResult extends ProvisionOperationalStoreResult {
  /** The stores row the source now points at via legacy_woo_store_id. */
  storeId: string;
}

/**
 * The WooCommerce bridge: provision the transitional store for a freshly
 * created `order_sources` row and stamp its id on `legacy_woo_store_id`.
 * Throws on failure — the caller keeps the source creation fail-soft.
 */
export async function bridgeWooSourceToStore(params: {
  sourceId: string;
  brandId: string;
  sourceName: string;
  config: Record<string, unknown>;
}): Promise<BridgeWooSourceResult> {
  const url = typeof params.config.url === "string" ? params.config.url.trim() : "";
  const consumerKey = typeof params.config.consumer_key === "string" ? params.config.consumer_key.trim() : "";
  const consumerSecret =
    typeof params.config.consumer_secret === "string" ? params.config.consumer_secret.trim() : "";
  if (!url) throw new Error("the source has no store URL");

  // A fully configured http(s) connection is sync-ready (the 15-minute
  // woo-sync-all cron selects status='connected'); anything else — including
  // every local:// row — stays 'disconnected' and can never be picked up.
  const status =
    isSyncableStoreUrl(url) && consumerKey && consumerSecret ? "connected" : "disconnected";

  const provisioned = await provisionOperationalStore({
    brandId: params.brandId,
    name: params.sourceName,
    url,
    status,
    consumerKey: consumerKey || undefined,
    consumerSecret: consumerSecret || undefined,
  });

  const { error: stampError } = await supabase
    .from("order_sources")
    .update({ legacy_woo_store_id: provisioned.storeId })
    .eq("id", params.sourceId);
  if (stampError) {
    throw new Error(
      `store space created but not recorded on the source: ${stampError.message}`,
    );
  }
  return { ...provisioned, storeId: provisioned.storeId };
}
