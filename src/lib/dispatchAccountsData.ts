/**
 * Data access for branded Pathao Account dispatch (issue #22).
 *
 * All Pathao account labels come from `pathao_integrations_safe` and active
 * `pathao_stores` rows — never from raw `pathao_integrations`, whose credential
 * columns are admin-only. Pure grouping/selection logic lives in
 * `@/lib/dispatchAccounts`.
 */

import { supabase } from "@/integrations/supabase/client";
import { deriveBrandForStore, type BrandIdentityBrand } from "@/lib/brandIdentity";
import { addOrderTimeline } from "@/lib/orderTimeline";
import { logAction } from "@/lib/auditLog";
import {
  buildPathaoAccountOptions,
  type DispatchOrderIdentity,
  type PathaoAccountOption,
  type PathaoStoreLinkRow,
} from "@/lib/dispatchAccounts";

export interface PathaoAccountData {
  accounts: PathaoAccountOption[];
  links: PathaoStoreLinkRow[];
}

/**
 * Load the selectable Pathao Accounts and the per-brand default links.
 * Errors degrade to empty lists so selectors render instead of breaking.
 */
export async function fetchPathaoAccountData(): Promise<PathaoAccountData> {
  const [integrationsRes, storesRes, linksRes] = await Promise.all([
    supabase.from("pathao_integrations_safe" as any).select("id, name, is_active"),
    supabase
      .from("pathao_stores")
      .select("pathao_store_id, store_name, integration_id, is_active")
      .eq("is_active", true),
    supabase
      .from("pathao_store_links")
      .select("woo_store_id, pathao_integration_id, default_pathao_store_id"),
  ]);

  if (integrationsRes.error) console.warn("fetchPathaoAccountData: integrations", integrationsRes.error.message);
  if (storesRes.error) console.warn("fetchPathaoAccountData: stores", storesRes.error.message);
  if (linksRes.error) console.warn("fetchPathaoAccountData: links", linksRes.error.message);

  return {
    accounts: buildPathaoAccountOptions(
      (integrationsRes.data || []) as any,
      (storesRes.data || []) as any,
    ),
    links: (linksRes.data || []) as PathaoStoreLinkRow[],
  };
}

interface OrderIdentityRow {
  id: string;
  store_id: string | null;
  selling_point_id: string | null;
  selling_points: {
    id: string;
    name: string | null;
    brand_id: string | null;
    woo_store_id: string | null;
    brands: { id: string; name: string | null; logo_url: string | null; woo_store_id: string | null } | null;
  } | null;
}

/**
 * Resolve per-order Brand/Selling Point identity for a dispatch batch.
 * The Selling Point's Brand binding wins; rows without one fall back to the
 * legacy `store_id` binding through `deriveBrandForStore`.
 */
export async function fetchDispatchOrderIdentity(
  orderIds: readonly string[],
  brands: readonly BrandIdentityBrand[],
): Promise<DispatchOrderIdentity[]> {
  if (orderIds.length === 0) return [];
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, store_id, selling_point_id, selling_points(id, name, brand_id, woo_store_id, brands(id, name, logo_url, woo_store_id))",
    )
    .in("id", [...orderIds]);
  if (error) {
    console.warn("fetchDispatchOrderIdentity failed:", error.message);
    return [];
  }

  return ((data || []) as unknown as OrderIdentityRow[]).map((row) => {
    const brandRow = row.selling_points?.brands;
    const fallbackBrand = brandRow ? undefined : deriveBrandForStore(brands, row.store_id);
    return {
      id: row.id,
      brandId: brandRow?.id ?? fallbackBrand?.id ?? null,
      brandName: brandRow?.name ?? fallbackBrand?.name ?? null,
      brandLogoUrl: brandRow?.logo_url ?? null,
      brandWooStoreId: brandRow?.woo_store_id ?? fallbackBrand?.woo_store_id ?? null,
      sellingPointName: row.selling_points?.name ?? null,
      sellingPointWooStoreId: row.selling_points?.woo_store_id ?? null,
      legacyStoreId: row.store_id,
    };
  });
}

export interface PathaoAccountOverrideRecord {
  /** Orders dispatched through the override. */
  orderIds: readonly string[];
  /** Optional order_number per order id, for audit details. */
  orderNumbers?: Readonly<Record<string, string>>;
  brandName: string | null;
  defaultAccount: PathaoAccountOption | null;
  selectedAccount: PathaoAccountOption;
  /**
   * "dispatched" (default): the override was used for a courier booking.
   * "created": the override was chosen at order creation (the intended
   * dispatch account, used by Create & Dispatch — issue #23).
   */
  context?: "created" | "dispatched";
}

/**
 * Record a non-default Pathao Account choice on every order it dispatched:
 * one order-timeline entry per order plus one audit-log entry per order.
 * Recording is best-effort — a logging failure never fails the caller's flow.
 */
export async function recordPathaoAccountOverride(
  record: PathaoAccountOverrideRecord,
): Promise<void> {
  const { orderIds, orderNumbers, brandName, defaultAccount, selectedAccount } = record;
  if (orderIds.length === 0) return;

  const brandLabel = brandName || "No Brand";
  const fromLabel = defaultAccount
    ? `${defaultAccount.accountName} · ${defaultAccount.pickupStoreName}`
    : "no default";
  const toLabel = `${selectedAccount.accountName} · ${selectedAccount.pickupStoreName}`;
  const verb = record.context === "created" ? "chosen" : "used";

  try {
    await addOrderTimeline(
      orderIds.map((orderId) => ({
        order_id: orderId,
        event: "dispatch_account_override",
        description: `Pathao Account override for ${brandLabel}: ${toLabel} ${verb} instead of the default (${fromLabel})`,
        // Internal operational detail — not mirrored to the Woo order notes.
        metadata: {
          skip_woo_note: true,
          brand_name: brandName,
          context: record.context ?? "dispatched",
          default_account_key: defaultAccount?.key ?? null,
          selected_account_key: selectedAccount.key,
        },
      })),
    );

    await Promise.all(
      orderIds.map((orderId) =>
        logAction("dispatch_pathao_account_override", "order", orderId, {
          order_number: orderNumbers?.[orderId] ?? null,
          brand_name: brandName,
          context: record.context ?? "dispatched",
          default_account: defaultAccount
            ? {
                key: defaultAccount.key,
                integration_id: defaultAccount.integrationId,
                pathao_store_id: defaultAccount.pathaoStoreId,
                account_name: defaultAccount.accountName,
                pickup_store_name: defaultAccount.pickupStoreName,
              }
            : null,
          selected_account: {
            key: selectedAccount.key,
            integration_id: selectedAccount.integrationId,
            pathao_store_id: selectedAccount.pathaoStoreId,
            account_name: selectedAccount.accountName,
            pickup_store_name: selectedAccount.pickupStoreName,
          },
        }),
      ),
    );
  } catch (err: any) {
    console.warn("recordPathaoAccountOverride failed:", err?.message || err);
  }
}
