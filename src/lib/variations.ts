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