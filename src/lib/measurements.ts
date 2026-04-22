import { supabase } from "@/integrations/supabase/client";

export interface MeasurementField {
  id: string;
  group_id: string;
  name: string;
  sort_order: number;
}

export interface MeasurementGroup {
  id: string;
  name: string;
  display_format: "label_value" | "dash_separated";
  unit: string;
  sort_order: number;
  fields: MeasurementField[];
}

export interface MeasurementAssignment {
  id: string;
  group_id: string;
  product_id: string | null;
  category_id: string | null;
}

export interface CapturedMeasurement {
  groupId?: string;
  groupName: string;
  displayFormat: "label_value" | "dash_separated";
  unit: string;
  values: { name: string; value: string }[];
  notes?: string;
  source?: "pos" | "woo";
}

/** Load all groups + their fields, ordered. */
export async function loadMeasurementGroups(): Promise<MeasurementGroup[]> {
  const [{ data: groups }, { data: fields }] = await Promise.all([
    supabase.from("measurement_groups" as any).select("id, name, display_format, unit, sort_order").order("sort_order"),
    supabase.from("measurement_fields" as any).select("id, group_id, name, sort_order").order("sort_order"),
  ]);
  const fieldsByGroup = new Map<string, MeasurementField[]>();
  ((fields as any[]) || []).forEach((f) => {
    if (!fieldsByGroup.has(f.group_id)) fieldsByGroup.set(f.group_id, []);
    fieldsByGroup.get(f.group_id)!.push(f);
  });
  return ((groups as any[]) || []).map((g) => ({
    ...g,
    fields: (fieldsByGroup.get(g.id) || []).sort((a, b) => a.sort_order - b.sort_order),
  }));
}

/** Resolve which groups apply to a product (direct + via its categories). */
export async function getGroupsForProduct(productId: string): Promise<MeasurementGroup[]> {
  const allGroups = await loadMeasurementGroups();
  if (allGroups.length === 0) return [];

  const { data: catLinks } = await supabase
    .from("product_categories")
    .select("category_id")
    .eq("product_id", productId);
  const categoryIds = (catLinks || []).map((c: any) => c.category_id);

  const { data: assignments } = await supabase
    .from("measurement_assignments" as any)
    .select("group_id, product_id, category_id");

  const matchedGroupIds = new Set<string>();
  ((assignments as any[]) || []).forEach((a) => {
    if (a.product_id === productId) matchedGroupIds.add(a.group_id);
    if (a.category_id && categoryIds.includes(a.category_id)) matchedGroupIds.add(a.group_id);
  });

  return allGroups.filter((g) => matchedGroupIds.has(g.id));
}

export interface SizePreset {
  id: string;
  group_id: string;
  product_id: string | null;
  size_label: string;
  values: { name: string; value: string }[];
}

/**
 * Detect the size token (e.g. "L", "XL", "32") from an order item.
 * Looks at WooCommerce-style line meta first (`meta_data` array), then the
 * variation attributes JSON we store, then falls back to parsing the variation
 * name / product name (last token after dash/slash/space).
 */
export function detectSizeFromItem(item: {
  meta_data?: any;
  variation_attributes?: any;
  variation_name?: string | null;
  product_name?: string | null;
}): string | null {
  const SIZE_KEYS = ["size", "pa_size", "attribute_pa_size", "attribute_size"];

  // 1. WooCommerce meta_data
  const meta = item.meta_data;
  if (Array.isArray(meta)) {
    for (const m of meta) {
      const key = String(m?.key || m?.display_key || "").toLowerCase().trim();
      if (SIZE_KEYS.some((k) => key === k || key.endsWith(k))) {
        const val = String(m?.value || m?.display_value || "").trim();
        if (val) return val;
      }
    }
  }

  // 2. Variation attributes JSON we store (array of {key, value} or {name, option})
  const attrs = item.variation_attributes;
  if (Array.isArray(attrs)) {
    for (const a of attrs) {
      const key = String(a?.key || a?.name || "").toLowerCase().trim();
      if (SIZE_KEYS.some((k) => key === k || key.endsWith(k)) || key === "size") {
        const val = String(a?.value || a?.option || "").trim();
        if (val) return val;
      }
    }
  }

  // 3. Parse the variation/product name — last segment after `-`, `/`, or space.
  const name = (item.variation_name || item.product_name || "").trim();
  if (name) {
    const tokens = name.split(/[\s\-\/|]+/).filter(Boolean);
    const last = tokens[tokens.length - 1];
    if (last && last.length <= 4) return last;
  }
  return null;
}

/**
 * Load the best matching size preset for a (group, product, size) combination.
 * Product-scoped overrides win over group defaults.
 */
export async function resolveSizePreset(
  groupId: string,
  productId: string | null,
  sizeLabel: string
): Promise<SizePreset | null> {
  const wantedLabel = sizeLabel.toLowerCase().trim();
  if (!wantedLabel) return null;

  const { data } = await supabase
    .from("measurement_size_presets" as any)
    .select("id, group_id, product_id, size_label, values")
    .eq("group_id", groupId);

  const rows = ((data as any[]) || []).filter((r) => String(r.size_label).toLowerCase().trim() === wantedLabel);
  if (rows.length === 0) return null;

  // Prefer the product-scoped override
  const productMatch = productId ? rows.find((r) => r.product_id === productId) : null;
  const chosen = productMatch || rows.find((r) => r.product_id === null) || rows[0];
  return {
    ...chosen,
    values: Array.isArray(chosen.values) ? chosen.values : [],
  };
}

/** Format captured measurement values per its display format. */
export function formatMeasurement(m: CapturedMeasurement): string {
  const filled = m.values.filter((v) => v.value && String(v.value).trim() !== "");
  if (filled.length === 0) return "";
  if (m.displayFormat === "dash_separated") {
    return filled.map((v) => v.value).join("-") + (m.unit ? ` ${m.unit}` : "");
  }
  return filled.map((v) => `${v.name}: ${v.value}${m.unit ? ` ${m.unit}` : ""}`).join(", ");
}

/** Persist measurements for an order item. */
export async function saveOrderItemMeasurements(
  orderId: string,
  orderItemId: string | null,
  measurements: CapturedMeasurement[]
) {
  if (!measurements || measurements.length === 0) return;
  const rows = measurements.map((m) => ({
    order_id: orderId,
    order_item_id: orderItemId,
    group_name: m.groupName,
    display_format: m.displayFormat,
    unit: m.unit,
    values: m.values,
    source: m.source || "pos",
    notes: m.notes || null,
  }));
  await supabase.from("order_item_measurements" as any).insert(rows as any);
}
