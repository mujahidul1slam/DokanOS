import { supabase } from "@/integrations/supabase/client";
import {
  emptyMeasurementRulesConfig,
  parseMeasurementRulesConfig,
  resolveGroupIdsForProduct,
  type AssignmentRule,
  type MeasurementRulesConfig,
} from "@/lib/measurementRules";

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

/**
 * Resolve which groups apply to a product: direct product assignments plus
 * category assignments honoring their scope (direct / cascade_all /
 * cascade_selected / cascade_except), minus per-product never-measure
 * overrides (issue #28). The category tree is walked at match time, so
 * subcategories created after an assignment are picked up dynamically.
 */
export async function getGroupsForProduct(productId: string): Promise<MeasurementGroup[]> {
  const allGroups = await loadMeasurementGroups();
  if (allGroups.length === 0) return [];

  const [catLinksRes, assignmentsRes, categoriesRes, rules] = await Promise.all([
    supabase.from("product_categories").select("category_id").eq("product_id", productId),
    supabase
      .from("measurement_assignments" as any)
      .select("id, group_id, product_id, category_id"),
    supabase.from("categories").select("id, parent_id"),
    loadMeasurementRulesConfig(),
  ]);

  const productCategoryIds = ((catLinksRes.data as any[]) || []).map((c) => c.category_id);

  const assignmentRules: AssignmentRule[] = ((assignmentsRes.data as any[]) || []).map((a) => {
    const scopeRule = rules.categoryScopes[a.id];
    return {
      groupId: a.group_id,
      productId: a.product_id,
      categoryId: a.category_id,
      scope: scopeRule?.scope ?? "direct",
      includedCategoryIds: scopeRule?.includedCategoryIds ?? [],
      excludedCategoryIds: scopeRule?.excludedCategoryIds ?? [],
    };
  });

  const matchedGroupIds = new Set(
    resolveGroupIdsForProduct({
      productId,
      productCategoryIds,
      categories: ((categoriesRes.data as any[]) || []).map((c) => ({
        id: c.id,
        parent_id: c.parent_id,
      })),
      assignments: assignmentRules,
      neverMeasureProductIds: Object.keys(rules.productOverrides),
    })
  );

  return allGroups.filter((g) => matchedGroupIds.has(g.id));
}

/* ---- Rules config persistence (app_settings KV, key "measurement_rules") ---- */

const RULES_CONFIG_KEY = "measurement_rules";

/** Load the scope modifiers + per-product overrides, tolerant of bad payloads. */
export async function loadMeasurementRulesConfig(): Promise<MeasurementRulesConfig> {
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", RULES_CONFIG_KEY)
      .maybeSingle();
    if (error) return emptyMeasurementRulesConfig();
    return parseMeasurementRulesConfig((data as any)?.value);
  } catch {
    return emptyMeasurementRulesConfig();
  }
}

/** Persist the whole rules config as one app_settings row (upsert by key). */
export async function saveMeasurementRulesConfig(config: MeasurementRulesConfig): Promise<void> {
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: RULES_CONFIG_KEY, value: config as any },
      { onConflict: "key" }
    );
  if (error) throw error;
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
  // Treat any attribute whose normalized key contains "size" as the size attribute.
  // This handles "size", "pa_size", "attribute_pa_size", "Size--", "Size:", "Shirt Size", etc.
  const isSizeKey = (rawKey: string): boolean => {
    const k = rawKey.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!k) return false;
    // Exact / suffix matches first to avoid catching unrelated words
    if (k === "size" || k.endsWith("size") || k.startsWith("size")) return true;
    return false;
  };

  const cleanValue = (v: string): string => v.replace(/^[:\-\s]+|[:\-\s]+$/g, "").trim();

  // 1. WooCommerce meta_data
  const meta = item.meta_data;
  if (Array.isArray(meta)) {
    for (const m of meta) {
      const key = String(m?.key || m?.display_key || "").trim();
      if (isSizeKey(key)) {
        const val = cleanValue(String(m?.value || m?.display_value || ""));
        if (val) return val;
      }
    }
  }

  // 2. Variation attributes JSON we store (array of {key, value} or {name, option})
  const attrs = item.variation_attributes;
  if (Array.isArray(attrs)) {
    for (const a of attrs) {
      const key = String(a?.key || a?.name || "").trim();
      if (isSizeKey(key)) {
        const val = cleanValue(String(a?.value || a?.option || ""));
        if (val) return val;
      }
    }
  }

  // 3. Parse the variation/product name. WooCommerce formats it as either:
  //    "Product Name - Size--: L / Pant Design: Gurkha"  (order_items.product_name)
  //    "L / Gurkha Cutting Belt"                          (product_variations.name)
  // Strategy: look for a "size...: VALUE" segment first, then fall back to
  // splitting on " / " and treating the FIRST short token as the size.
  const fullName = (item.product_name || item.variation_name || "").trim();
  if (fullName) {
    // a) "Size--: L" or "Size: L" style
    const labeled = fullName.match(/size[^a-z0-9]*[:\-]+\s*([^\/|,]+?)(?:\s*[\/|,]|$)/i);
    if (labeled && labeled[1]) {
      const val = cleanValue(labeled[1]);
      if (val) return val;
    }
  }

  // b) Try variation_name, or — if absent — derive a variation segment from
  //    product_name (Woo formats as "Product Name - L / Gurkha Cutting Belt"
  //    where the part after the last " - " is the variation attributes block).
  let variationOnly = (item.variation_name || "").trim();
  if (!variationOnly && item.product_name) {
    const pn = item.product_name.trim();
    const idx = pn.lastIndexOf(" - ");
    if (idx > -1) variationOnly = pn.slice(idx + 3).trim();
  }
  if (variationOnly) {
    // Split on " / " and find the token most likely to be a size code:
    // prefer short, single-word, alphanumeric tokens that look like sizes
    // (S/M/L/XL/XXL/numeric). Woo isn't guaranteed to list size first.
    const parts = variationOnly.split(/\s*\/\s*/).map((s) => s.trim()).filter(Boolean);
    const sizeLike = /^(xx?s|x?s|m|x?l|xx?l|xxx?l|[0-9]{1,3}(\.[0-9]+)?)$/i;
    const sized = parts.find((p) => sizeLike.test(p));
    if (sized) return sized;
    // Otherwise, only accept a single-token short value if there is exactly
    // one such candidate (avoid blindly returning a design/colour name).
    const shortSingles = parts.filter((p) => p.length <= 4 && !/\s/.test(p));
    if (shortSingles.length === 1) return shortSingles[0];
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
