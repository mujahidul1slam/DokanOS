/**
 * Shared mapping functions for WooCommerce integrations.
 * Used by woo-webhook and woo-sync.
 */

export function mapWooStatus(status: string, paymentMethod?: string): string {
  const isCod = (paymentMethod || "").toLowerCase().includes("cod") ||
                (paymentMethod || "").toLowerCase().includes("cash on delivery");
  const map: Record<string, string> = {
    pending: "pending",
    processing: "processing",
    // Non-COD on-hold = awaiting payment confirmation; COD on-hold falls back to processing
    "on-hold": isCod ? "processing" : "payment_pending",
    completed: "completed", cancelled: "cancelled", refunded: "returned",
    failed: "cancelled", shipped: "shipped",
  };
  return map[status] || "pending";
}

export function fromWooStockStatus(status: string): string {
  const map: Record<string, string> = {
    instock: "in_stock", outofstock: "out_of_stock", onbackorder: "on_backorder",
    in_stock: "in_stock", out_of_stock: "out_of_stock", on_backorder: "on_backorder",
  };
  return map[status] || "in_stock";
}

export function derivePaymentStatus(o: any): string {
  const method = (o.payment_method || "").toLowerCase();
  const title = (o.payment_method_title || "").toLowerCase();
  const status = (o.status || "").toLowerCase();
  const isCod = method === "cod" || title.includes("cash on delivery");
  if (isCod) return "cod";
  
  // Non-COD orders (bKash, Nagad, card, bank, etc.)
  // on-hold = awaiting payment confirmation
  if (status === "on-hold") return "online";
  if (status === "pending") return "unpaid";
  if (status === "completed" || status === "processing") return "paid";
  return "unpaid";
}

export function fromWooShipping(o: any): string {
  const lines = Array.isArray(o?.shipping_lines) ? o.shipping_lines : [];
  if (lines.length === 0) return "delivery"; // online order with no shipping line — still not walk-in
  const title = String(lines[0]?.method_title || "").toLowerCase();
  const id = String(lines[0]?.method_id || "").toLowerCase();
  if (title.includes("pickup") || title.includes("showroom") || id.includes("pickup") || id.includes("local_pickup")) {
    return "pickup";
  }
  return "delivery";
}

export function normalizePhone(raw: any): string | null {
  if (!raw) return null;
  let p = String(raw).replace(/[^0-9]/g, "");
  if (!p) return null;
  if (p.startsWith("880") && p.length >= 13) p = p.slice(3);
  if (p.length === 10 && p.startsWith("1")) p = "0" + p;
  return p;
}

export function extractMeasurementsFromMeta(
  meta: any[],
  fieldMap: Map<string, { groupName: string; displayFormat: string; unit: string; fieldName: string }>
): Array<{ groupName: string; displayFormat: string; unit: string; values: { name: string; value: string }[] }> {
  if (!Array.isArray(meta) || meta.length === 0 || fieldMap.size === 0) return [];
  const grouped = new Map<string, { displayFormat: string; unit: string; values: { name: string; value: string }[] }>();
  for (const m of meta) {
    const rawKey = String(m?.key ?? m?.display_key ?? "").trim();
    if (!rawKey || rawKey.startsWith("_")) continue;
    const key = rawKey.toLowerCase();
    const match = fieldMap.get(key);
    if (!match) continue;
    const value = String(m?.value ?? m?.display_value ?? "").trim();
    if (!value) continue;
    if (!grouped.has(match.groupName)) {
      grouped.set(match.groupName, { displayFormat: match.displayFormat, unit: match.unit, values: [] });
    }
    grouped.get(match.groupName)!.values.push({ name: match.fieldName, value });
  }
  return Array.from(grouped.entries()).map(([groupName, info]) => ({
    groupName, displayFormat: info.displayFormat, unit: info.unit, values: info.values,
  }));
}

export function buildVariationLabel(
  meta: any[],
  measurementNamesOrFieldMap: Set<string> | Map<string, any>
): string {
  if (!Array.isArray(meta) || meta.length === 0) return "";
  const parts: string[] = [];
  for (const m of meta) {
    const rawKey = String(m?.display_key ?? m?.key ?? "").trim();
    if (!rawKey || rawKey.startsWith("_")) continue;
    
    // Support both Set (from woo-webhook) and Map (from woo-sync)
    const lowerKey = rawKey.toLowerCase();
    const isMeasurement = measurementNamesOrFieldMap instanceof Set 
      ? measurementNamesOrFieldMap.has(lowerKey)
      : measurementNamesOrFieldMap.has(lowerKey);
      
    if (isMeasurement) continue;
    
    const value = String(m?.display_value ?? m?.value ?? "").trim();
    if (!value || value.includes("<")) continue;
    parts.push(`${rawKey}: ${value}`);
  }
  return parts.join(" / ");
}
