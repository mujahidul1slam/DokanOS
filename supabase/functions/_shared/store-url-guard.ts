/**
 * Sync-safety guard shared by the WooCommerce sync workers (woo-sync,
 * woo-sync-all, woo-push).
 *
 * Option B (2026-11-01) provisions operational `stores` rows from order-source
 * connections and a "local store" convenience. Local rows carry `local://` URLs
 * and are created status='disconnected' (the woo-sync-all cron only selects
 * status='connected'); this guard is the second line of defense so a non-http(s)
 * store URL can NEVER reach a sync call, whatever its status says. Pure logic —
 * mirrored in src/lib/operationalStores.ts (isSyncableStoreUrl) for UI-side
 * filtering.
 */

export function isSyncableStoreUrl(url: string | null | undefined): boolean {
  return /^https?:\/\//i.test((url ?? "").trim());
}

export const NON_HTTP_STORE_URL_ERROR =
  "Store URL is not an http(s) URL — refusing to sync (local/offline store space).";
