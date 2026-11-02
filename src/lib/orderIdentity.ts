/**
 * Pure helpers for changing an order's Brand / Order Source identity from
 * Order Info (issue #32).
 *
 * Glossary terms (see GLOSSARY.md):
 * - Brand: commercial identity; owns a Woo store binding (`woo_store_id`).
 * - Order Source: the place/channel an order was taken at; every source belongs
 *   to exactly one brand, and an order belongs to exactly one source for
 *   operational attribution. Task 16 retired the legacy `selling_points` table
 *   — a selling point is now simply an order source of a physical type
 *   (showroom / showroom_pos / physical_store / manual).
 * - Pathao account: the Pathao merchant account used to dispatch an order.
 * - Consignment: a single parcel booking with a courier; an order can hold
 *   several over its life, one active at most.
 *
 * The resolution rules mirror Add Order (issue #21): a single available source
 * is auto-selected; zero sources block the change with a configure hint. The
 * per-brand default Pathao Account lives in `pathao_store_links`, keyed by the
 * brand's `woo_store_id` (issue #22) and is re-resolved through
 * `@/lib/dispatchAccounts` whenever the Brand or Order Source changes.
 *
 * This module is intentionally pure (no supabase) so the rules stay unit
 * testable; data loading lives in the callers.
 */

export interface IdentityBrand {
  id: string;
  name: string;
  woo_store_id: string | null;
}

export interface IdentityOrderSource {
  id: string;
  name: string;
  brand_id: string | null;
  type?: string | null;
}

/** Order sources belonging to one brand (name order preserved). */
export function orderSourcesForBrand<P extends IdentityOrderSource>(
  sources: readonly P[],
  brandId: string | null | undefined,
): P[] {
  if (!brandId) return [];
  return sources.filter((source) => source.brand_id === brandId);
}

export type OrderSourceResolutionReason =
  /** The caller's previous choice is still valid — keep it (editable). */
  | "kept"
  /** The only available option was auto-selected. */
  | "only"
  /** Zero options: the change is blocked until an Order Source is configured. */
  | "none";

export interface OrderSourceResolution {
  orderSourceId: string | null;
  reason: OrderSourceResolutionReason;
}

/**
 * Resolve the Order Source for a brand's option list.
 *
 * Order of rules (issue #21): keep the previous selection when it is still an
 * option; otherwise auto-select the single option; otherwise stay unresolved so
 * the operator must configure one rather than silently attributing the order.
 */
export function resolveOrderSource<P extends IdentityOrderSource>(
  sources: readonly P[],
  previousId?: string | null,
): OrderSourceResolution {
  if (previousId && sources.some((source) => source.id === previousId)) {
    return { orderSourceId: previousId, reason: "kept" };
  }
  if (sources.length === 1) return { orderSourceId: sources[0].id, reason: "only" };
  return { orderSourceId: null, reason: "none" };
}

/**
 * The legacy `orders.store_id` write value: the Brand's `woo_store_id`, else
 * (only when the Brand is unchanged) the previous legacy binding.
 *
 * It is a Woo store binding ONLY — never an order source / selling point UUID.
 * Order sources carry `legacy_woo_store_id`, but that column holds a provisioned
 * `stores.id` UUID (see `bridgeWooSourceToStore`), not a Woo numeric id, so it
 * cannot be used as the legacy binding.
 */
export function legacyStoreIdFor(
  brand: Pick<IdentityBrand, "woo_store_id"> | null | undefined,
  options: { previousStoreId?: string | null; brandChanged?: boolean } = {},
): string | null {
  const brandBinding = brand?.woo_store_id || null;
  if (brandBinding) return brandBinding;
  // A brand change makes the previous binding belong to the old brand — it
  // must not leak into the new identity.
  if (options.brandChanged) return null;
  return options.previousStoreId || null;
}

export interface ConsignmentRow {
  consignment_id: string;
  cancelled_at?: string | null;
}

/**
 * Consignment ids that are still active (at most one per glossary, but older
 * rows may hold several; only non-cancelled ones count). The legacy single
 * `orders.consignment_id` is included when no shipment row already covers it.
 */
export function activeConsignmentIds(
  shipments: readonly ConsignmentRow[],
  legacyConsignmentId?: string | null,
): string[] {
  const ids = shipments
    .filter((shipment) => !shipment.cancelled_at)
    .map((shipment) => shipment.consignment_id)
    .filter(Boolean);
  if (legacyConsignmentId && !ids.includes(legacyConsignmentId)) {
    ids.push(legacyConsignmentId);
  }
  return ids;
}

export interface ConsignmentAccountConflict {
  /** True when the change must warn: active consignment on another account. */
  conflicted: boolean;
  consignmentIds: string[];
  bookedAccountKey: string | null;
  nextDefaultAccountKey: string | null;
}

/**
 * Detect when the order already has an active consignment booked through a
 * different Pathao Account than the identity change's new default. The courier
 * record is never rewritten — the existing booking keeps its account — but the
 * operator must be warned before saving instead of silently desyncing.
 *
 * Unknown account keys (legacy bookings without an integration/store record,
 * or brands without a configured default) cannot establish "another account",
 * so they do not raise a false warning.
 */
export function consignmentAccountConflict(
  shipments: readonly ConsignmentRow[],
  legacyConsignmentId: string | null | undefined,
  bookedAccountKey: string | null | undefined,
  nextDefaultAccountKey: string | null | undefined,
): ConsignmentAccountConflict {
  const consignmentIds = activeConsignmentIds(shipments, legacyConsignmentId);
  const booked = bookedAccountKey || null;
  const next = nextDefaultAccountKey || null;
  return {
    conflicted: consignmentIds.length > 0 && Boolean(booked && next && booked !== next),
    consignmentIds,
    bookedAccountKey: booked,
    nextDefaultAccountKey: next,
  };
}

export interface IdentitySelection {
  brandId: string | null;
  orderSourceId: string | null;
}

/** True when the Brand or Order Source differs from the stored order. */
export function identityChanged(
  before: IdentitySelection,
  after: IdentitySelection,
): boolean {
  const normalize = (value: string | null | undefined) => value || null;
  return (
    normalize(before.brandId) !== normalize(after.brandId) ||
    normalize(before.orderSourceId) !== normalize(after.orderSourceId)
  );
}

/** True when a Brand is selected but no Order Source resolves — the change is blocked. */
export function identityChangeBlocked(
  brandId: string | null | undefined,
  resolution: OrderSourceResolution | null | undefined,
): boolean {
  return Boolean(brandId) && !resolution?.orderSourceId;
}

export const ORDER_SOURCE_CONFIGURE_HINT =
  "No Order Source is configured for this Brand. Add one in Brands → Order Sources.";

export interface IdentitySnapshot {
  brandId: string | null;
  brandName: string | null;
  orderSourceId: string | null;
  orderSourceName: string | null;
  accountKey: string | null;
  accountLabel: string | null;
}

export interface IdentityChangeDescription {
  description: string;
  changes: string[];
  metadata: Record<string, unknown>;
}

const label = (value: string | null | undefined) => `"${value || "—"}"`;

/**
 * Build the timeline description + audit metadata for an identity change,
 * covering Brand, Order Source, and the re-resolved default Pathao Account.
 */
export function describeIdentityChange(
  before: IdentitySnapshot,
  after: IdentitySnapshot,
): IdentityChangeDescription {
  const changes: string[] = [];
  if ((before.brandId || null) !== (after.brandId || null)) {
    changes.push(`Brand: ${label(before.brandName)} → ${label(after.brandName)}`);
  }
  if ((before.orderSourceId || null) !== (after.orderSourceId || null)) {
    changes.push(`Order Source: ${label(before.orderSourceName)} → ${label(after.orderSourceName)}`);
  }
  if ((before.accountKey || null) !== (after.accountKey || null)) {
    changes.push(`default Pathao Account: ${label(before.accountLabel)} → ${label(after.accountLabel)}`);
  }
  return {
    description: `Order identity changed — ${changes.join(", ")}`,
    changes,
    metadata: {
      changes,
      brand: { from: before.brandId, to: after.brandId, from_name: before.brandName, to_name: after.brandName },
      order_source: {
        from: before.orderSourceId,
        to: after.orderSourceId,
        from_name: before.orderSourceName,
        to_name: after.orderSourceName,
      },
      pathao_account: {
        from: before.accountKey,
        to: after.accountKey,
        from_label: before.accountLabel,
        to_label: after.accountLabel,
      },
    },
  };
}