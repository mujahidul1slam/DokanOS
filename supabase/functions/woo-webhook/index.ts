import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { 
  mapWooStatus, 
  fromWooStockStatus, 
  derivePaymentStatus, 
  fromWooShipping, 
  normalizePhone, 
  extractMeasurementsFromMeta, 
  buildVariationLabel 
} from "../_shared/woo-mapping.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-wc-webhook-signature, x-wc-webhook-source, x-wc-webhook-topic, x-wc-webhook-delivery-id",
};

function jsonResp(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.text();
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) return jsonResp({ ok: true });

    const payload = JSON.parse(body);
    if (payload.webhook_id && !payload.line_items && !payload.name && !payload.sku) {
      return jsonResp({ ok: true });
    }

    // Skip echo loop if DokanOS originated the update
    if (payload.meta_data?.some((m: any) => m.key === "_dokan_origin")) {
      return jsonResp({ ok: true, skipped: "echo" });
    }

    const webhookSource = req.headers.get("x-wc-webhook-source") || "";
    const webhookTopic = req.headers.get("x-wc-webhook-topic") || "";
    const deliveryId = req.headers.get("x-wc-webhook-delivery-id") || "";

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Idempotency check: if we already processed this delivery, skip it
    if (deliveryId) {
      const { data: existingEvent } = await supabase
        .from("webhook_events")
        .select("id")
        .eq("delivery_id", deliveryId)
        .maybeSingle();
      if (existingEvent) {
        return jsonResp({ ok: true, skipped: "duplicate" });
      }
    }

    const normalizedSource = webhookSource.replace(/\/+$/, "");
    const { data: store } = await supabase
      .from("stores")
      .select("id, consumer_key, consumer_secret, url")
      .or(`url.eq.${normalizedSource},url.eq.${normalizedSource}/`)
      .limit(1)
      .single();

    if (!store) {
      console.error("No store found for webhook source:", webhookSource);
      return jsonResp({ error: "Unknown store" }, 404);
    }

    const store_id = store.id;
    const isProduct = webhookTopic.startsWith("product.") || (payload.name && !payload.line_items && payload.type);
    const isOrder = webhookTopic.startsWith("order.") || payload.line_items;
    const entityType = isOrder ? "order" : (isProduct ? "product" : "unknown");

    const signature = req.headers.get("x-wc-webhook-signature") || "";
    if (store.consumer_secret && signature) {
      try {
        const key = await crypto.subtle.importKey(
          "raw", new TextEncoder().encode(store.consumer_secret),
          { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
        );
        const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
        const expected = btoa(String.fromCharCode(...sig));
        // Phase 2: reject forged/spoofed payloads. WooCommerce signs the raw
        // request body with the store's consumer_secret; a mismatch means the
        // caller is not WooCommerce, so we must NOT persist the payload.
        if (signature !== expected) {
          console.error("Webhook signature mismatch — rejecting payload.", { store_id });
          if (deliveryId) {
            supabase.from("webhook_events").insert({
              store_id, delivery_id: deliveryId, topic: webhookTopic,
              woo_id: payload.id || null, entity_type: entityType,
              status_code: 401, error: "signature mismatch", payload_size: body.length,
            }).then();
          }
          return jsonResp({ error: "invalid signature" }, 401);
        }
      } catch (sigErr) {
        console.warn("Signature verification error:", sigErr);
        return jsonResp({ error: "signature verification failed" }, 401);
      }
    }

    let resultResponse;
    try {
      if (isProduct) resultResponse = await handleProductWebhook(supabase, store, payload);
      else if (isOrder) resultResponse = await handleOrderWebhook(supabase, store_id, payload);
      else resultResponse = jsonResp({ ok: true, message: "Unhandled topic" });

      if (deliveryId) {
        supabase.from("webhook_events").insert({
          store_id: store_id,
          delivery_id: deliveryId,
          topic: webhookTopic,
          woo_id: payload.id || null,
          entity_type: entityType,
          status_code: resultResponse.status,
          payload_size: body.length
        }).then();
      }
      return resultResponse;
    } catch (handlerErr: any) {
      if (deliveryId) {
        supabase.from("webhook_events").insert({
          store_id: store_id,
          delivery_id: deliveryId,
          topic: webhookTopic,
          woo_id: payload.id || null,
          entity_type: entityType,
          status_code: 500,
          error: handlerErr.message,
          payload_size: body.length
        }).then();
      }
      throw handlerErr;
    }
  } catch (err: any) {
    console.error("woo-webhook error:", err);
    return jsonResp({ error: err.message }, 500);
  }
});

/* ====== PRODUCT WEBHOOK ====== */
async function handleProductWebhook(supabase: any, store: any, p: any) {
  const store_id = store.id;
  if (p.type === "variation") return jsonResp({ ok: true, skipped: "variation" });

  const productData = {
    store_id, woo_product_id: p.id, name: p.name, sku: p.sku || null,
    description: p.short_description || p.description || null,
    price: parseFloat(p.price) || 0,
    cost_price: parseFloat(p.meta_data?.find((m: any) => m.key === "_cost")?.value) || 0,
    stock_quantity: p.stock_quantity ?? 0, manage_stock: p.manage_stock ?? false,
    stock_status: fromWooStockStatus(p.stock_status || "instock"),
    backorders: p.backorders || "no",
    category: p.categories?.map((c: any) => c.name).join(", ") || null,
    image_url: p.images?.[0]?.src || null, is_active: p.status === "publish",
    barcode: p.meta_data?.find((m: any) => m.key === "_barcode")?.value || null,
    woo_updated_at: p.date_modified_gmt ? new Date(p.date_modified_gmt + "Z").toISOString() : null,
  };

  const { data: existing } = await supabase
    .from("products").select("id, woo_updated_at")
    .eq("woo_product_id", p.id).eq("store_id", store_id).maybeSingle();

  let productId: string;
  if (existing) {
    // Phase 2 idempotency guard: skip if the incoming snapshot is older.
    if (productData.woo_updated_at && existing.woo_updated_at &&
        productData.woo_updated_at < existing.woo_updated_at) {
      return jsonResp({ ok: true, skipped: "stale", product_id: existing.id });
    }
    const { error } = await supabase.from("products").update(productData).eq("id", existing.id);
    if (error) return jsonResp({ error: "Failed to update product" }, 500);
    productId = existing.id;
  } else {
    const { data: inserted, error } = await supabase.from("products").insert(productData).select("id").single();
    if (error || !inserted) return jsonResp({ error: "Failed to insert product" }, 500);
    productId = inserted.id;
  }

  if (p.categories && Array.isArray(p.categories)) {
    const { data: dbCats } = await supabase.from("categories").select("id, woo_category_id").eq("store_id", store_id);
    const catMap = new Map((dbCats || []).map((c: any) => [c.woo_category_id, c.id]));
    await supabase.from("product_categories").delete().eq("product_id", productId);
    const pcRows = p.categories.map((c: any) => catMap.get(c.id)).filter(Boolean)
      .map((catId: string) => ({ product_id: productId, category_id: catId }));
    if (pcRows.length > 0) await supabase.from("product_categories").insert(pcRows);
  }

  // For variable products, fetch and upsert variations from WC REST API.
  if (p.type === "variable" && store.url && store.consumer_key && store.consumer_secret) {
    try {
      await syncProductVariations(supabase, store, p.id, productId);
    } catch (e: any) {
      console.warn(`Variation sync failed for product ${p.id}: ${e?.message || e}`);
    }
  }

  return jsonResp({ success: true, product_id: productId });
}

async function syncProductVariations(supabase: any, store: any, wooProductId: number, productId: string) {
  const baseUrl = String(store.url).replace(/\/+$/, "");
  const auth = "Basic " + btoa(`${store.consumer_key}:${store.consumer_secret}`);
  const wooVars: any[] = [];
  let page = 1;
  while (true) {
    const url = `${baseUrl}/wp-json/wc/v3/products/${wooProductId}/variations?per_page=100&page=${page}`;
    const res = await fetch(url, { headers: { Authorization: auth } });
    if (!res.ok) throw new Error(`WC variations ${res.status}`);
    const chunk = await res.json();
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    wooVars.push(...chunk);
    if (chunk.length < 100) break;
    page++;
  }
  if (wooVars.length === 0) return;

  const varRows = wooVars.map((v: any) => ({
    product_id: productId,
    woo_variation_id: v.id,
    name: v.attributes?.map((a: any) => a.option).join(" / ") || `Variation ${v.id}`,
    sku: v.sku || null,
    price: parseFloat(v.price) || 0,
    manage_stock: v.manage_stock === true, // Woo can return "parent" string; coerce to boolean
    stock_quantity: v.stock_quantity ?? 0,
    stock_status: fromWooStockStatus(v.stock_status || "instock"),
    barcode: v.meta_data?.find((m: any) => m.key === "_barcode")?.value || null,
    attributes: (v.attributes || []).map((a: any) => ({ key: a.name || a.slug, value: a.option })),
  }));

  const { error } = await supabase
    .from("product_variations")
    .upsert(varRows, { onConflict: "woo_variation_id,product_id", ignoreDuplicates: false });
  if (error) console.error(`Variations upsert error for product ${wooProductId}:`, error);
}

/* ====== ORDER WEBHOOK ====== */
async function handleOrderWebhook(supabase: any, store_id: string, o: any) {
  const customer_id = await resolveOrCreateCustomer(supabase, store_id, o);

  const { data: dbProducts } = await supabase
    .from("products").select("id, woo_product_id").eq("store_id", store_id);
  const prodMap = new Map((dbProducts || []).map((p: any) => [p.woo_product_id, p.id]));

  const billingName = `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim();
  const billingAddr = [o.billing?.address_1, o.billing?.address_2].filter(Boolean).join(", ") || null;

  const baseOrderNum = String(o.number || o.id);
  const { data: formatted } = await supabase.rpc("format_order_number", {
    p_store_id: store_id, p_source: "woo", p_base: baseOrderNum,
  });

  const method = (o.payment_method || "").toLowerCase();
  const title = (o.payment_method_title || "").toLowerCase();
  const orderIsCod = method === "cod" || title.includes("cash on delivery");
  const orderTotal = parseFloat(o.total) || 0;

  const orderData = {
    store_id,
    woo_order_id: o.id,
    order_number: (formatted as string) || baseOrderNum,
    source: "online",
    status: mapWooStatus(o.status, o.payment_method || o.payment_method_title || ""),
    payment_method: o.payment_method_title || o.payment_method || null,
    payment_status: derivePaymentStatus(o),
    fulfillment_type: fromWooShipping(o),
    subtotal: parseFloat(o.total) - parseFloat(o.shipping_total || "0") + parseFloat(o.discount_total || "0"),
    discount: parseFloat(o.discount_total) || 0,
    shipping_cost: parseFloat(o.shipping_total) || 0,
    total: orderTotal,
    amount_to_collect: orderIsCod ? orderTotal : 0,
    customer_id,
    customer_name: billingName || null,
    customer_phone: normalizePhone(o.billing?.phone),
    customer_email: o.billing?.email || null,
    customer_address: billingAddr,
    customer_city: o.billing?.city || null,
    notes: o.customer_note || null,
    woo_updated_at: o.date_modified_gmt ? new Date(o.date_modified_gmt + "Z").toISOString() : null,
  };

  const { data: existingOrder } = await supabase
    .from("orders").select("id, status, payment_status, amount_to_collect, woo_updated_at")
    .eq("woo_order_id", o.id).eq("store_id", store_id).maybeSingle();

  let orderId: string;
  let isNewOrder = false;
  let cancelledTransition = false;
  if (existingOrder) {
    // Phase 2 idempotency guard: WooCommerce can redeliver older snapshots out of
    // order. If the payload's modified time is not strictly newer than what we
    // already hold, skip the write entirely to avoid clobbering newer data.
    if (orderData.woo_updated_at && existingOrder.woo_updated_at &&
        orderData.woo_updated_at < existingOrder.woo_updated_at) {
      return jsonResp({ ok: true, skipped: "stale", order_id: existingOrder.id });
    }

    // Protect locally-advanced orders: if the order has already moved past
    // payment_pending (e.g. payment confirmed → processing / pre_order_pending),
    // do NOT let a stale webhook overwrite status, payment_status, or
    // amount_to_collect back to the Woo-derived values.
    // We still allow cancellation / refund from Woo (those are always authoritative).
    const LOCALLY_ADVANCED = new Set([
      "processing", "pre_order_pending", "pre_order_making", "pre_order_ready",
      "ready_to_ship", "shipped", "delivered", "completed",
    ]);
    const incomingIsTerminal = orderData.status === "cancelled" || orderData.status === "returned" || orderData.status === "completed";
    const locallyAdvanced = LOCALLY_ADVANCED.has(existingOrder.status) && !incomingIsTerminal;

    const updatePayload = locallyAdvanced
      ? (() => {
          // Keep all data fields fresh EXCEPT status, payment_status, and amount_to_collect
          const { status: _s, payment_status: _ps, amount_to_collect: _atc, ...rest } = orderData;
          return rest;
        })()
      : orderData;

    const { error } = await supabase.from("orders").update(updatePayload).eq("id", existingOrder.id);
    if (error) return jsonResp({ error: "Failed to update order" }, 500);
    orderId = existingOrder.id;
    if (existingOrder.status !== "cancelled" && orderData.status === "cancelled") {
      cancelledTransition = true;
    }
  } else {
    const orderInsert = { ...orderData, created_at: o.date_created_gmt ? o.date_created_gmt + "Z" : undefined };
    const { data: inserted, error } = await supabase.from("orders").insert(orderInsert).select("id").single();
    if (error || !inserted) return jsonResp({ error: "Failed to insert order" }, 500);
    orderId = inserted.id;
    isNewOrder = true;
  }

  if (isNewOrder) {
    await supabase.from("order_timeline").insert({
      order_id: orderId,
      event: "created",
      description: `Order received from WooCommerce — Total ৳${(parseFloat(o.total) || 0).toLocaleString()}`,
      metadata: {
        source: "woo_webhook",
        woo_order_id: o.id,
        woo_status: o.status,
        total: parseFloat(o.total) || 0,
        user_name: "WooCommerce",
        user_email: null,
      },
    });
  } else if (cancelledTransition) {
    await supabase.from("order_timeline").insert({
      order_id: orderId,
      event: "cancelled",
      description: `Order cancelled in WooCommerce (status: ${o.status})`,
      metadata: {
        source: "woo_webhook",
        woo_order_id: o.id,
        woo_status: o.status,
        previous_status: existingOrder?.status || null,
        user_name: "WooCommerce",
        user_email: null,
      },
    });
    await supabase.from("audit_log").insert({
      action: "order_cancelled",
      entity_type: "order",
      entity_id: orderId,
      user_email: "woocommerce@system",
      details: {
        source: "woo_webhook",
        woo_order_id: o.id,
        woo_status: o.status,
        previous_status: existingOrder?.status || null,
      },
    });
  }

  await supabase.from("order_items").delete().eq("order_id", orderId);
  await supabase.from("order_item_measurements").delete().eq("order_id", orderId).eq("source", "woo");

  // fieldMap is built below for measurements; we need it earlier to filter variation meta.
  const { data: mFieldsEarly } = await supabase
    .from("measurement_fields")
    .select("name");
  const measurementNameSet = new Set<string>(
    ((mFieldsEarly as any[]) || []).map((f: any) => String(f.name).toLowerCase().trim())
  );

  const items = (o.line_items || []).map((li: any) => {
    const variationLabel = buildVariationLabel(li.meta_data || [], measurementNameSet);
    const fullName = variationLabel ? `${li.name} - ${variationLabel}` : li.name;
    return {
      order_id: orderId,
      product_id: prodMap.get(li.product_id) || null,
      product_name: fullName,
      quantity: li.quantity,
      unit_price: parseFloat(li.price) || 0,
      line_total: parseFloat(li.total) || 0,
    };
  });
  let insertedItems: any[] = [];
  if (items.length > 0) {
    const { data: ins } = await supabase.from("order_items").insert(items).select("id");
    insertedItems = ins || [];
  }

  // Import measurement metadata
  const { data: mFields } = await supabase
    .from("measurement_fields")
    .select("name, group_id, measurement_groups(name, display_format, unit)");
  const fieldMap = new Map<string, { groupName: string; displayFormat: string; unit: string; fieldName: string }>();
  ((mFields as any[]) || []).forEach((f: any) => {
    const g = f.measurement_groups;
    if (!g) return;
    fieldMap.set(String(f.name).toLowerCase().trim(), {
      groupName: g.name, displayFormat: g.display_format || "label_value",
      unit: g.unit || "in", fieldName: f.name,
    });
  });

  const measRows: any[] = [];
  (o.line_items || []).forEach((li: any, idx: number) => {
    const dbItem = insertedItems[idx];
    extractMeasurementsFromMeta(li.meta_data || [], fieldMap).forEach((g) => {
      measRows.push({
        order_id: orderId, order_item_id: dbItem?.id || null,
        group_name: g.groupName, display_format: g.displayFormat,
        unit: g.unit, values: g.values, source: "woo",
      });
    });
  });
  extractMeasurementsFromMeta(o.meta_data || [], fieldMap).forEach((g) => {
    measRows.push({
      order_id: orderId, order_item_id: null,
      group_name: g.groupName, display_format: g.displayFormat,
      unit: g.unit, values: g.values, source: "woo",
    });
  });
  if (measRows.length > 0) {
    const { error: mErr } = await supabase.from("order_item_measurements").insert(measRows);
    if (mErr) console.warn("Measurement insert warn:", mErr.message);
  }

  return jsonResp({ success: true, order_id: orderId });
}



async function resolveOrCreateCustomer(supabase: any, store_id: string, o: any): Promise<string | null> {
  const phone = normalizePhone(o.billing?.phone);
  const email = o.billing?.email?.trim() || null;
  const billingName = `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim() || null;
  const address = [o.billing?.address_1, o.billing?.address_2].filter(Boolean).join(", ") || null;
  const city = o.billing?.city || null;

  if (!phone && !email && !billingName) return null;

  let customerId: string | null = null;

  // 1. GLOBAL lookup by phone (any store)
  if (phone) {
    const { data } = await supabase.from("customers").select("id").eq("phone", phone).maybeSingle();
    if (data) customerId = data.id;
  }

  // 2. Fallback: lookup by email (any store) — only if no phone match
  if (!customerId && email) {
    const { data } = await supabase.from("customers").select("id").eq("email", email).maybeSingle();
    if (data) customerId = data.id;
  }

  // 3. Create if not found
  if (!customerId) {
    const { data: created, error } = await supabase.from("customers").insert({
      store_id,
      name: billingName || "Guest",
      email, phone, address, city,
    }).select("id").single();

    if (error || !created) {
      // Race on global phone unique — refetch
      if (phone) {
        const { data: retry } = await supabase.from("customers").select("id").eq("phone", phone).maybeSingle();
        if (retry) customerId = retry.id;
      }
      if (!customerId) {
        console.warn("Customer insert failed:", error?.message);
        return null;
      }
    } else {
      customerId = created.id;
    }
  }

  // 4. Record aliases (name / email / address) with source store. Dedup via unique index.
  const aliasRows: any[] = [];
  if (billingName) aliasRows.push({ customer_id: customerId, type: "name", value: billingName, source_store_id: store_id });
  if (email) aliasRows.push({ customer_id: customerId, type: "email", value: email, source_store_id: store_id });
  const fullAddr = [address, city].filter(Boolean).join(", ");
  if (fullAddr) aliasRows.push({ customer_id: customerId, type: "address", value: fullAddr, source_store_id: store_id });

  if (aliasRows.length > 0) {
    // Insert ignoring duplicates (the unique index on (customer_id, type, lower(value)) prevents repeats)
    for (const row of aliasRows) {
      const { error: aErr } = await supabase.from("customer_aliases").insert(row);
      if (aErr && !String(aErr.message || "").includes("duplicate")) {
        console.warn("Alias insert warn:", aErr.message);
      }
    }
  }

  return customerId;
}

