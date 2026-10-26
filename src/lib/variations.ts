/**
 * Shared variation-attribute parsing (Phase 3 / §6.2) — the canonical version,
 * extracted from the three prior implementations (AddOrderDialog, pos/VariationModal,
 * MeasurementSlipPrint). Behavior-preserving; output is `Array<{name, option}>`
 * keyed under this module's names.
 */

export interface ParsedAttr {
  name: string;
  option: string;
}

/**
 * Parse a product_variations.attributes jsonb value into a flat list of
 * {name, option} entries. Handles:
 *   - array-of-objects  [{ key: "Size", value: "L" }, ...]
 *   - array-of-objects  [{ Size: "L" }, ...]
 *   - array-of-objects  [{ name: "Size", option: "L" }, ...]
 *   - string / malformed → []
 */
export function parseVariationAttributes(attrs: any): ParsedAttr[] {
  if (typeof attrs === "string" || !Array.isArray(attrs)) return [];
  const out: ParsedAttr[] = [];
  for (const a of attrs) {
    if (!a || typeof a !== "object") continue;
    // Canonical {name, option}
    if (a.name && a.option) {
      out.push({ name: String(a.name), option: String(a.option) });
      continue;
    }
    // {key, value}
    if (a.key && a.value) {
      out.push({ name: String(a.key), option: String(a.value) });
      continue;
    }
    const k = Object.keys(a).find((k) => k !== "key" && k !== "value" && k !== "name" && k !== "option");
    if (k && a[k] != null) out.push({ name: k, option: String(a[k]) });
  }
  return out;
}

/** Human-readable label from parsed attributes, e.g. "Size: L". */
export function formatVariationLabel(attrs: ParsedAttr[]): string {
  return attrs.map((a) => `${a.name}: ${a.option}`).join(" · ");
}

/** value-joined label, e.g. "L / Red" (matches the Order name convention). */
export function joinVariationOptions(attrs: ParsedAttr[]): string {
  return attrs.map((a) => a.option).join(" / ");
}

/**
 * Resolve which variations belong to a product.
 *
 * The `products.id` ↔ `product_variations.product_id` link is a UUID foreign
 * key, and PostgreSQL compares UUIDs **case-insensitively**. Screens that
 * filter server-side (`.eq("product_id", id)` — e.g. pos/VariationModal) are
 * therefore correct for every product, while client-side `===` comparisons are
 * not: a variation whose `product_id` differs only in case from `products.id`
 * still links correctly in SQL, yet fails a strict JS string comparison. On the
 * Add Order screen that failure meant the variation modal was skipped entirely
 * (product added with no size) and, when the modal did open, in-stock
 * variations were hidden as unselectable.
 *
 * This helper performs the lookup the same way the database does — trimmed and
 * case-insensitive — so both screens agree on which variations a product has.
 *
 * Variations with a non-string `product_id` are malformed (the column is a
 * UUID) and are ignored rather than matched or crashed on.
 */
export function getProductVariations<T extends { product_id?: unknown }>(
  productId: string | null | undefined,
  variations: readonly T[] | null | undefined,
): T[] {
  if (typeof productId !== "string") return [];
  const target = productId.trim().toLowerCase();
  if (!target) return [];
  if (!Array.isArray(variations)) return [];

  const out: T[] = [];
  for (const v of variations) {
    if (!v || typeof v !== "object") continue;
    const pid = (v as { product_id?: unknown }).product_id;
    if (typeof pid !== "string") continue;
    if (pid.trim().toLowerCase() === target) out.push(v);
  }
  return out;
}