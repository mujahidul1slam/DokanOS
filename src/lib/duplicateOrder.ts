/**
 * Pure duplicate-order detection for the warn-only duplicate warning (issue #29).
 *
 * Rule (settled decision — see GLOSSARY.md "Duplicate order"): a newly-taken
 * order is a duplicate candidate when it matches a recent order by the same
 * customer (normalized phone — the existing dedup key) + at least one same
 * product + the same brand within 48h. Stores and selling points may differ
 * and still count.
 *
 * The warning is warn-only and dismissible by design: this module NEVER blocks
 * saving. It returns plain data; the UI decides how to render and dismiss it.
 */

/** 48h window. Named constant so it can be tuned later (issue #29 acceptance). */
export const DUPLICATE_ORDER_WINDOW_HOURS = 48;

/** The duplicate window in milliseconds. */
export const DUPLICATE_ORDER_WINDOW_MS =
  DUPLICATE_ORDER_WINDOW_HOURS * 60 * 60 * 1000;

/**
 * Canonical customer-phone key (the existing dedup key), matching the
 * normalization used when syncing customer_phone
 * (supabase/functions/_shared/woo-mapping.ts): digits only, the "880"
 * country prefix dropped, and 10-digit local numbers padded to the
 * 0-prefixed 11-digit form.
 *
 * Returns null for empty/unusable input: orders without a phone never match
 * each other (anonymous walk-ins are never false duplicates).
 */
export function normalizeCustomerPhone(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let digits = String(raw).replace(/[^0-9]/g, "");
  if (!digits) return null;
  if (digits.startsWith("880") && digits.length >= 13) digits = digits.slice(3);
  if (digits.length === 10 && digits.startsWith("1")) digits = "0" + digits;
  return digits;
}

export interface ParsedOrderItemName {
  /** Base product name with the variation segment removed. */
  readonly name: string;
  /** The variation label after the last " - ", or null for a plain line. */
  readonly variationLabel: string | null;
}

/**
 * Parse order_items.product_name using the "Name - variationLabel" convention:
 * the part after the LAST " - " is the variation attributes block
 * (see measurements.ts). "Cotton Shirt - L / Navy" ->
 * { name: "Cotton Shirt", variationLabel: "L / Navy" }.
 */
export function parseOrderItemName(productName: string): ParsedOrderItemName {
  const full = String(productName ?? "").trim();
  const idx = full.lastIndexOf(" - ");
  if (idx < 0) return { name: full, variationLabel: null };
  const name = full.slice(0, idx).trim();
  const variationLabel = full.slice(idx + 3).trim();
  return {
    name: name || full,
    variationLabel: variationLabel || null,
  };
}

/** One order line as the detector needs it. */
export interface DuplicateOrderLine {
  /** Product identity when known (order_items.product_id). */
  readonly productId?: string | null;
  /** order_items.product_name, using the "Name - variationLabel" convention. */
  readonly productName: string;
}

/** A taken order (or the newly-taken order being checked) as the detector needs it. */
export interface DuplicateOrderCandidate {
  readonly orderNumber: string;
  /** When the order was taken (orders.created_at): ISO string or Date. */
  readonly createdAt: string | Date;
  readonly customerPhone?: string | null;
  /**
   * Derived brand identity (store -> brand, see brandIdentity.ts). Required
   * by the rule: orders with an unknown brand never produce a warning.
   */
  readonly brandId?: string | null;
  /** Carried for the caller's convenience; ignored by the rule — stores may differ. */
  readonly storeId?: string | null;
  /** Carried for the caller's convenience; ignored by the rule — selling points may differ. */
  readonly sellingPointId?: string | null;
  readonly items: readonly DuplicateOrderLine[];
}

/** One product shared by the new order and a matched recent order. */
export interface SharedProductMatch {
  /** Base product name shared by both orders (variation segment removed). */
  readonly name: string;
  /** Variation label on the new order's line (null when plain). */
  readonly newVariationLabel: string | null;
  /** Variation label on the matched order's line (null when plain). */
  readonly previousVariationLabel: string | null;
  /** The new order's raw product_name line that produced this match. */
  readonly newOrderLine: string;
  /** The matched order's raw product_name line that produced this match. */
  readonly previousOrderLine: string;
}

/** A recent order matching the duplicate rule, with why it matched. */
export interface DuplicateOrderMatch {
  readonly orderNumber: string;
  /** When the matched order was taken (orders.created_at, as provided). */
  readonly createdAt: string;
  readonly sharedProducts: readonly SharedProductMatch[];
}

/** The warn-only result: enough detail for a dismissible UI warning. */
export interface DuplicateOrderWarning {
  /** Warn-only flag: true when the UI should show a dismissible duplicate warning. */
  readonly isDuplicateCandidate: boolean;
  /** Matching recent orders, most recent first. */
  readonly matches: readonly DuplicateOrderMatch[];
}

/** Normalized comparison key for a base product name. */
function productNameKey(productName: string): string {
  return parseOrderItemName(productName)
    .name.trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** Product identity: product ids win when both lines know them, else base names. */
function linesMatch(a: DuplicateOrderLine, b: DuplicateOrderLine): boolean {
  const aId = String(a.productId ?? "").trim();
  const bId = String(b.productId ?? "").trim();
  if (aId && bId) return aId === bId;
  const key = productNameKey(a.productName);
  return key !== "" && key === productNameKey(b.productName);
}

function sharedProductsBetween(
  newItems: readonly DuplicateOrderLine[],
  previousItems: readonly DuplicateOrderLine[],
): SharedProductMatch[] {
  const seen = new Set<string>();
  const shared: SharedProductMatch[] = [];
  for (const newItem of newItems) {
    const dedupeKey =
      String(newItem.productId ?? "").trim() || productNameKey(newItem.productName);
    if (!dedupeKey || seen.has(dedupeKey)) continue;
    const previousItem = previousItems.find((p) => linesMatch(newItem, p));
    if (!previousItem) continue;
    seen.add(dedupeKey);
    const parsedNew = parseOrderItemName(newItem.productName);
    const parsedPrevious = parseOrderItemName(previousItem.productName);
    shared.push({
      name: parsedNew.name,
      newVariationLabel: parsedNew.variationLabel,
      previousVariationLabel: parsedPrevious.variationLabel,
      newOrderLine: newItem.productName,
      previousOrderLine: previousItem.productName,
    });
  }
  return shared;
}

function toTime(value: string | Date): number | null {
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

function brandKey(brandId: string | null | undefined): string | null {
  const key = String(brandId ?? "").trim();
  return key ? key : null;
}

/** Deterministic match order: most recent first, then by order number. */
function compareMatches(a: DuplicateOrderMatch, b: DuplicateOrderMatch): number {
  const at = toTime(a.createdAt) ?? 0;
  const bt = toTime(b.createdAt) ?? 0;
  if (at !== bt) return bt - at;
  return a.orderNumber < b.orderNumber ? -1 : a.orderNumber > b.orderNumber ? 1 : 0;
}

/**
 * Detect duplicate candidates for a newly-taken order against recent orders.
 *
 * A recent order matches when ALL of the following hold (the settled rule):
 * - same customer: equal normalized phones (see normalizeCustomerPhone),
 * - same brand: equal derived brand identity (store -> brand),
 * - at least one same product (product id when known, otherwise base name
 *   parsed from the "Name - variationLabel" convention — variation lines of
 *   one product are the same product),
 * - the two orders were taken within 48h of each other (see
 *   DUPLICATE_ORDER_WINDOW_HOURS).
 *
 * Stores and selling points are ignored. An order is never a duplicate of
 * itself (same orderNumber). The result is warn-only plain data; it never
 * blocks saving.
 */
export function findDuplicateOrders(
  candidate: DuplicateOrderCandidate,
  recentOrders: readonly DuplicateOrderCandidate[],
): DuplicateOrderWarning {
  const candidateTime = toTime(candidate.createdAt);
  const candidatePhone = normalizeCustomerPhone(candidate.customerPhone);
  const candidateBrand = brandKey(candidate.brandId);
  if (candidateTime === null || candidatePhone === null || candidateBrand === null) {
    return { isDuplicateCandidate: false, matches: [] };
  }

  const matches: DuplicateOrderMatch[] = [];
  for (const recent of recentOrders) {
    // An order is never a duplicate of itself.
    if (recent.orderNumber === candidate.orderNumber) continue;
    const recentTime = toTime(recent.createdAt);
    const recentPhone = normalizeCustomerPhone(recent.customerPhone);
    const recentBrand = brandKey(recent.brandId);
    if (recentTime === null || recentPhone === null || recentBrand === null) continue;
    if (recentPhone !== candidatePhone) continue;
    if (recentBrand !== candidateBrand) continue;
    if (Math.abs(candidateTime - recentTime) > DUPLICATE_ORDER_WINDOW_MS) continue;
    const sharedProducts = sharedProductsBetween(candidate.items, recent.items);
    if (sharedProducts.length === 0) continue;
    matches.push({
      orderNumber: recent.orderNumber,
      createdAt: recent.createdAt instanceof Date
        ? recent.createdAt.toISOString()
        : recent.createdAt,
      sharedProducts,
    });
  }

  matches.sort(compareMatches);
  return { isDuplicateCandidate: matches.length > 0, matches };
}
