import { supabase } from "@/integrations/supabase/client";
import { detectSizeFromItem, getGroupsForProduct, resolveSizePreset, type CapturedMeasurement } from "@/lib/measurements";
import { addOrderTimeline } from "@/lib/orderTimeline";
import { isOrderPreOrderByProducts } from "@/lib/preOrderSettings";

/**
 * If the order is currently in pre_order_pending status, promote it to
 * pre_order_making (the "in production" stage) — printing the measurement
 * slip is the trigger that production has begun.
 */
async function promotePreOrderOnSlipPrint(orderId: string) {
  try {
    const { data: order } = await supabase
      .from("orders")
      .select("id, status, consignment_id")
      .eq("id", orderId)
      .single();
    if (!order) return;

    // Already past the "making" stage — nothing to do.
    if (["pre_order_making", "pre_order_ready", "ready_to_ship", "shipped", "delivered", "completed", "cancelled", "returned"].includes(order.status)) {
      return;
    }

    // Detect whether this order is treated as a pre-order: either it sits in
    // pre_order_pending, or it's still in processing/on_hold/pending and
    // contains a product whose category is configured as a Pre-Order category.
    let isPreOrder = order.status === "pre_order_pending";
    let fromLabel = "Pre-Order";
    let fromStatus = order.status;

    if (!isPreOrder && ["processing", "on_hold", "pending"].includes(order.status) && !order.consignment_id) {
      const { data: items } = await supabase
        .from("order_items")
        .select("product_id")
        .eq("order_id", orderId);
      const productIds = (items || []).map((i: any) => i.product_id).filter(Boolean);
      if (await isOrderPreOrderByProducts(productIds)) {
        isPreOrder = true;
        fromLabel = order.status === "processing" ? "New Order" : order.status;
      }
    }

    if (!isPreOrder) return;

    await supabase.from("orders").update({ status: "pre_order_making" }).eq("id", orderId);
    await addOrderTimeline({
      order_id: orderId,
      event: "status_changed",
      description: `Status changed from "${fromLabel}" to "Making" — measurement slip printed`,
      metadata: { from: fromStatus, to: "pre_order_making", trigger: "measurement_slip_print" },
    });
  } catch (e) {
    console.warn("promotePreOrderOnSlipPrint failed:", e);
  }
}

interface SlipTpl {
  title?: string;
  print_format?: "thermal" | "a4";
  default_format?: "per_group" | "label_value" | "dash_separated";
  show_order_number?: boolean;
  show_order_date?: boolean;
  show_customer_name?: boolean;
  show_customer_phone?: boolean;
  show_product_name?: boolean;
  show_product_sku?: boolean;
  show_notes?: boolean;
  footer_text?: string;
}

interface OrderInfo {
  order_number: string;
  created_at: string;
  customer_name: string | null;
  customer_phone: string | null;
}

interface ProductLine {
  product_name: string;
  sku?: string | null;
  measurements: CapturedMeasurement[];
}

function renderMeasurement(m: CapturedMeasurement, override: SlipTpl["default_format"]) {
  const fmt = (override && override !== "per_group") ? override : m.displayFormat;
  const filled = m.values.filter((v) => v.value && String(v.value).trim() !== "");
  if (filled.length === 0) return "";
  if (fmt === "dash_separated") {
    return `<div style="font-size:20px;font-weight:700;letter-spacing:1px;margin-top:4px;">${filled.map((v) => v.value).join(" - ")}${m.unit ? ` ${m.unit}` : ""}</div>`;
  }
  return `<table style="width:100%;border-collapse:collapse;margin-top:6px;">
    ${filled.map((v) => `<tr>
      <td style="padding:5px 6px;font-size:15px;color:#333;border-bottom:1px dashed #d5d5d5;width:45%;">${v.name}</td>
      <td style="padding:5px 6px;font-size:18px;font-weight:700;border-bottom:1px dashed #d5d5d5;">${v.value}${m.unit ? ` ${m.unit}` : ""}</td>
    </tr>`).join("")}
  </table>`;
}

export async function printMeasurementSlip(orderId: string) {
  const [orderRes, itemsRes, measurementsRes, settingsRes] = await Promise.all([
    supabase.from("orders").select("order_number, created_at, customer_name, customer_phone").eq("id", orderId).single(),
    supabase.from("order_items").select("id, product_name, product_id").eq("order_id", orderId),
    supabase.from("order_item_measurements" as any).select("order_item_id, group_name, display_format, unit, values, notes").eq("order_id", orderId),
    supabase.from("invoice_settings" as any).select("measurement_slip_template, business_name").limit(1).single(),
  ]);

  const order = orderRes.data as OrderInfo | null;
  if (!order) {
    alert("Order not found");
    return;
  }

  const tpl: SlipTpl = ((settingsRes as any).data?.measurement_slip_template) || {};
  const businessName = (settingsRes as any).data?.business_name || "DokanOS";
  const items = (itemsRes.data || []) as any[];
  const allMeasurements = (measurementsRes as any).data || [];

  // Get product SKUs in batch
  const productIds = items.map((i) => i.product_id).filter(Boolean);
  const skuMap = new Map<string, string>();
  if (productIds.length > 0 && tpl.show_product_sku) {
    const { data: prods } = await supabase.from("products").select("id, sku").in("id", productIds);
    (prods || []).forEach((p: any) => p.sku && skuMap.set(p.id, p.sku));
  }

  // Group measurements by item
  const measByItem = new Map<string, CapturedMeasurement[]>();
  const orphans: CapturedMeasurement[] = [];
  allMeasurements.forEach((m: any) => {
    const captured: CapturedMeasurement = {
      groupName: m.group_name,
      displayFormat: m.display_format,
      unit: m.unit,
      values: Array.isArray(m.values) ? m.values : Object.entries(m.values || {}).map(([name, value]) => ({ name, value: String(value) })),
      notes: m.notes,
    };
    if (m.order_item_id) {
      if (!measByItem.has(m.order_item_id)) measByItem.set(m.order_item_id, []);
      measByItem.get(m.order_item_id)!.push(captured);
    } else {
      orphans.push(captured);
    }
  });

  // Build product lines, with size-preset auto-fill when no custom measurement was captured.
  const productLines: ProductLine[] = [];
  for (const i of items) {
    let measurements = measByItem.get(i.id) || [];

    // Custom measurements always win — only resolve presets when nothing was captured.
    if (measurements.length === 0 && i.product_id) {
      // 1. Detect size from variation attributes / product_name suffix
      let variationAttrs: any = null;
      let variationName: string | null = null;
      const dashIdx = (i.product_name || "").lastIndexOf(" - ");
      if (dashIdx > 0) variationName = (i.product_name || "").slice(dashIdx + 3);

      // Try to find a matching product_variations row (authoritative attributes)
      try {
        const { data: vars } = await supabase
          .from("product_variations")
          .select("name, attributes")
          .eq("product_id", i.product_id);
        if (vars && vars.length > 0 && variationName) {
          const match = vars.find((v: any) => String(v.name || "").trim().toLowerCase() === variationName!.trim().toLowerCase());
          if (match) variationAttrs = match.attributes;
        }
      } catch { /* ignore */ }

      const sizeLabel = detectSizeFromItem({
        variation_attributes: variationAttrs,
        variation_name: variationName,
        product_name: i.product_name,
      });

      if (sizeLabel) {
        // 2. Look up assigned measurement groups for this product
        const groups = await getGroupsForProduct(i.product_id);
        // 3. Resolve a preset for each group + size
        const resolved: CapturedMeasurement[] = [];
        for (const g of groups) {
          const preset = await resolveSizePreset(g.id, i.product_id, sizeLabel);
          if (preset && preset.values.length > 0) {
            resolved.push({
              groupName: `${g.name} (Size ${sizeLabel})`,
              displayFormat: g.display_format,
              unit: g.unit,
              values: preset.values,
              source: "woo",
            });
          }
        }
        if (resolved.length > 0) measurements = resolved;
      }
    }

    if (measurements.length > 0) {
      productLines.push({
        product_name: i.product_name,
        sku: skuMap.get(i.product_id),
        measurements,
      });
    }
  }

  if (productLines.length === 0 && orphans.length === 0) {
    alert("No measurements recorded for this order.");
    return;
  }

  const fmt = tpl.print_format || "thermal";
  const width = fmt === "thermal" ? "280px" : "210mm";
  const date = new Date(order.created_at);

  const headerInfo: string[] = [];
  if (tpl.show_order_number !== false) headerInfo.push(`<div><strong>Order:</strong> #${order.order_number}</div>`);
  if (tpl.show_order_date !== false) headerInfo.push(`<div style="color:#666;font-size:11px;">${date.toLocaleDateString()} · ${date.toLocaleTimeString()}</div>`);
  if (tpl.show_customer_name !== false && order.customer_name) headerInfo.push(`<div><strong>Customer:</strong> ${order.customer_name}</div>`);
  if (tpl.show_customer_phone !== false && order.customer_phone) headerInfo.push(`<div><strong>Phone:</strong> ${order.customer_phone}</div>`);

  const productSections = productLines.map((line) => `
    <div style="margin-top:14px;padding-top:10px;border-top:2px dashed #999;">
      ${tpl.show_product_name !== false ? `<div style="font-weight:700;font-size:13px;">${line.product_name}</div>` : ""}
      ${tpl.show_product_sku && line.sku ? `<div style="font-family:monospace;font-size:10px;color:#666;">SKU: ${line.sku}</div>` : ""}
      ${line.measurements.map((m) => `
        <div style="margin-top:10px;">
          <div style="font-size:13px;font-weight:700;text-transform:uppercase;color:#222;letter-spacing:0.8px;">${m.groupName}</div>
          ${renderMeasurement(m, tpl.default_format)}
          ${tpl.show_notes !== false && m.notes ? `<div style="font-size:12px;color:#555;margin-top:4px;font-style:italic;">${m.notes}</div>` : ""}
        </div>
      `).join("")}
    </div>
  `).join("");

  const orphanSection = orphans.length > 0 ? `
    <div style="margin-top:14px;padding-top:10px;border-top:2px dashed #999;">
      <div style="font-weight:700;font-size:13px;">General Measurements</div>
      ${orphans.map((m) => `
        <div style="margin-top:10px;">
          <div style="font-size:13px;font-weight:700;text-transform:uppercase;color:#222;letter-spacing:0.8px;">${m.groupName}</div>
          ${renderMeasurement(m, tpl.default_format)}
        </div>
      `).join("")}
    </div>
  ` : "";

  const html = `<!DOCTYPE html><html><head><title>Measurement Slip - ${order.order_number}</title>
    <style>
      @page { size: ${fmt === "thermal" ? "80mm auto" : "A4"}; margin: ${fmt === "thermal" ? "4mm" : "15mm"}; }
      body { font-family: 'Segoe UI', Arial, sans-serif; color: #111; margin: 0; padding: 0; }
      .slip { max-width: ${width}; margin: 0 auto; padding: ${fmt === "thermal" ? "8px" : "20px"}; }
      .title { text-align: center; font-size: ${fmt === "thermal" ? "14px" : "20px"}; font-weight: 800; letter-spacing: 2px; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 10px; }
      .biz { text-align: center; font-size: ${fmt === "thermal" ? "11px" : "13px"}; color: #666; margin-bottom: 4px; }
      .footer { text-align:center; margin-top: 16px; padding-top: 10px; border-top: 1px solid #ccc; font-size: 10px; color:#888; }
    </style></head><body><div class="slip">
      <div class="biz">${businessName}</div>
      <div class="title">${tpl.title || "MEASUREMENT SLIP"}</div>
      <div style="font-size:12px;line-height:1.5;">${headerInfo.join("")}</div>
      ${productSections}
      ${orphanSection}
      ${tpl.footer_text ? `<div class="footer">${tpl.footer_text}</div>` : ""}
    </div></body></html>`;

  const w = window.open("", "_blank", "width=800,height=600");
  if (w) {
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }

  // Auto-promote pre-order to "making" once the slip is printed.
  await promotePreOrderOnSlipPrint(orderId);
}

/**
 * Print measurement slips for many orders at once. Each slip opens in its own
 * window. Orders with no measurements recorded are silently skipped.
 */
export async function printMeasurementSlipsBulk(orderIds: string[]): Promise<{ printed: number; skipped: number }> {
  let printed = 0;
  let skipped = 0;
  for (const id of orderIds) {
    try {
      await printMeasurementSlip(id);
      printed++;
      await new Promise((r) => setTimeout(r, 400));
    } catch {
      skipped++;
    }
  }
  return { printed, skipped };
}
