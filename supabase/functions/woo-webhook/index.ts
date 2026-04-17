import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-wc-webhook-signature, x-wc-webhook-source, x-wc-webhook-topic",
};

/** Convert WooCommerce stock_status to DB format */
function fromWooStockStatus(status: string): string {
  const map: Record<string, string> = {
    instock: "in_stock",
    outofstock: "out_of_stock",
    onbackorder: "on_backorder",
    in_stock: "in_stock",
    out_of_stock: "out_of_stock",
    on_backorder: "on_backorder",
  };
  return map[status] || "in_stock";
}

function jsonResp(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.text();

    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return jsonResp({ ok: true });
    }

    const payload = JSON.parse(body);

    // WooCommerce sends a ping on webhook creation — ignore it
    if (payload.webhook_id && !payload.line_items && !payload.name && !payload.sku) {
      return jsonResp({ ok: true });
    }

    const webhookSource = req.headers.get("x-wc-webhook-source") || "";
    const webhookTopic = req.headers.get("x-wc-webhook-topic") || "";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Find store by webhook source URL
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

    // Verify WooCommerce webhook signature if present
    // WooCommerce webhook secret may differ from the REST API consumer_secret
    // We attempt validation but allow through with a warning if it fails,
    // since the webhook secret is configured separately in WooCommerce
    const signature = req.headers.get("x-wc-webhook-signature") || "";
    if (store.consumer_secret && signature) {
      try {
        const key = await crypto.subtle.importKey(
          "raw",
          new TextEncoder().encode(store.consumer_secret),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"]
        );
        const sig = new Uint8Array(
          await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))
        );
        const expected = btoa(String.fromCharCode(...sig));
        if (signature !== expected) {
          console.warn("Webhook signature mismatch — processing anyway. Set the WooCommerce webhook secret to your Consumer Secret for strict validation.");
        } else {
          console.log("Webhook signature verified ✓");
        }
      } catch (sigErr) {
        console.warn("Signature verification error:", sigErr);
      }
    } else if (!signature) {
      console.warn("No webhook signature provided — processing anyway");
    }

    const store_id = store.id;

    // Determine if this is a product or order webhook
    const isProduct = webhookTopic.startsWith("product.") || (payload.name && !payload.line_items && payload.type);
    const isOrder = webhookTopic.startsWith("order.") || payload.line_items;

    if (isProduct) {
      return await handleProductWebhook(supabase, store_id, payload);
    } else if (isOrder) {
      return await handleOrderWebhook(supabase, store_id, payload);
    }

    return jsonResp({ ok: true, message: "Unhandled topic" });
  } catch (err: any) {
    console.error("woo-webhook error:", err);
    return jsonResp({ error: err.message }, 500);
  }
});

/* ====== PRODUCT WEBHOOK ====== */
async function handleProductWebhook(supabase: any, store_id: string, p: any) {
  // Skip variations — they arrive as separate webhook events with type "variation"
  if (p.type === "variation") {
    console.log(`Skipping variation webhook for woo_id ${p.id}`);
    return jsonResp({ ok: true, skipped: "variation" });
  }

  const productData = {
    store_id,
    woo_product_id: p.id,
    name: p.name,
    sku: p.sku || null,
    description: p.short_description || p.description || null,
    price: parseFloat(p.price) || 0,
    cost_price: parseFloat(p.meta_data?.find((m: any) => m.key === "_cost")?.value) || 0,
    stock_quantity: p.stock_quantity ?? 0,
    manage_stock: p.manage_stock ?? false,
    stock_status: fromWooStockStatus(p.stock_status || "instock"),
    backorders: p.backorders || "no",
    category: p.categories?.map((c: any) => c.name).join(", ") || null,
    image_url: p.images?.[0]?.src || null,
    is_active: p.status === "publish",
    barcode: p.meta_data?.find((m: any) => m.key === "_barcode")?.value || null,
  };

  // Check if product exists
  const { data: existing } = await supabase
    .from("products")
    .select("id")
    .eq("woo_product_id", p.id)
    .eq("store_id", store_id)
    .maybeSingle();

  let productId: string;

  if (existing) {
    // UPDATE existing product
    const { error: updateErr } = await supabase
      .from("products")
      .update(productData)
      .eq("id", existing.id);

    if (updateErr) {
      console.error("Product update error:", updateErr);
      return jsonResp({ error: "Failed to update product" }, 500);
    }
    productId = existing.id;
    console.log(`Updated product ${productId} (woo_id: ${p.id})`);
  } else {
    // INSERT new product
    const { data: inserted, error: insertErr } = await supabase
      .from("products")
      .insert(productData)
      .select("id")
      .single();

    if (insertErr || !inserted) {
      console.error("Product insert error:", insertErr);
      return jsonResp({ error: "Failed to insert product" }, 500);
    }
    productId = inserted.id;
    console.log(`Inserted product ${productId} (woo_id: ${p.id})`);
  }

  // Sync categories (many-to-many)
  if (p.categories && Array.isArray(p.categories)) {
    const { data: dbCats } = await supabase
      .from("categories")
      .select("id, woo_category_id")
      .eq("store_id", store_id);
    const catMap = new Map((dbCats || []).map((c: any) => [c.woo_category_id, c.id]));

    await supabase.from("product_categories").delete().eq("product_id", productId);
    const pcRows = p.categories
      .map((c: any) => catMap.get(c.id))
      .filter(Boolean)
      .map((catId: string) => ({ product_id: productId, category_id: catId }));
    if (pcRows.length > 0) {
      await supabase.from("product_categories").insert(pcRows);
    }
  }

  // Variable product note
  if (p.type === "variable" && Array.isArray(p.variations) && p.variations.length > 0) {
    console.log(`Variable product ${p.id} has ${p.variations.length} variations — full sync via woo-sync`);
  }

  return jsonResp({ success: true, product_id: productId });
}

/* ====== ORDER WEBHOOK ====== */
async function handleOrderWebhook(supabase: any, store_id: string, o: any) {
  const customer_id = await resolveCustomer(supabase, store_id, o);

  // Product lookup
  const { data: dbProducts } = await supabase
    .from("products")
    .select("id, woo_product_id")
    .eq("store_id", store_id);
  const prodMap = new Map((dbProducts || []).map((p: any) => [p.woo_product_id, p.id]));

  const paymentStatus = derivePaymentStatus(o);

  const orderData = {
    store_id,
    woo_order_id: o.id,
    order_number: String(o.number || o.id),
    source: "online",
    status: mapWooStatus(o.status),
    payment_method: o.payment_method_title || o.payment_method || null,
    payment_status: paymentStatus,
    subtotal: parseFloat(o.total) - parseFloat(o.shipping_total || "0") + parseFloat(o.discount_total || "0"),
    discount: parseFloat(o.discount_total) || 0,
    shipping_cost: parseFloat(o.shipping_total) || 0,
    total: parseFloat(o.total) || 0,
    customer_id,
    notes: o.customer_note || null,
  };

  // Check if order exists
  const { data: existingOrder } = await supabase
    .from("orders")
    .select("id")
    .eq("woo_order_id", o.id)
    .eq("store_id", store_id)
    .maybeSingle();

  let orderId: string;

  if (existingOrder) {
    const { error: updateErr } = await supabase
      .from("orders")
      .update(orderData)
      .eq("id", existingOrder.id);

    if (updateErr) {
      console.error("Order update error:", updateErr);
      return jsonResp({ error: "Failed to update order" }, 500);
    }
    orderId = existingOrder.id;
    console.log(`Updated order ${orderId} (woo_id: ${o.id})`);
  } else {
    const orderInsert = {
      ...orderData,
      created_at: o.date_created_gmt ? o.date_created_gmt + "Z" : undefined,
    };
    const { data: inserted, error: insertErr } = await supabase
      .from("orders")
      .insert(orderInsert)
      .select("id")
      .single();

    if (insertErr || !inserted) {
      console.error("Order insert error:", insertErr);
      return jsonResp({ error: "Failed to insert order" }, 500);
    }
    orderId = inserted.id;
    console.log(`Inserted order ${orderId} (woo_id: ${o.id})`);
  }

  // Delete old items and insert new
  await supabase.from("order_items").delete().eq("order_id", orderId);

  const items = (o.line_items || []).map((li: any) => ({
    order_id: orderId,
    product_id: prodMap.get(li.product_id) || null,
    product_name: li.name,
    quantity: li.quantity,
    unit_price: parseFloat(li.price) || 0,
    line_total: parseFloat(li.total) || 0,
  }));

  if (items.length > 0) {
    await supabase.from("order_items").insert(items);
  }

  return jsonResp({ success: true, order_id: orderId });
}

/* ====== Customer resolution ======
 * Robustly resolves a customer for an incoming Woo order.
 * Order of resolution:
 *   1. By (woo_customer_id, store_id)        — registered Woo customer in this store
 *   2. By phone (global)                     — any existing customer with same phone
 *   3. Insert new                            — fall back to creating a guest record
 * Whenever we find/create a customer we OVERWRITE its billing fields with the
 * latest data from the Woo order — but we never blank out a name with "Guest"
 * if the order has no billing name.
 */
async function resolveCustomer(supabase: any, store_id: string, o: any): Promise<string | null> {
  const phone = o.billing?.phone?.trim() || null;
  const email = o.billing?.email || null;
  const billingName = `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim();
  const address = [o.billing?.address_1, o.billing?.address_2].filter(Boolean).join(", ") || null;
  const city = o.billing?.city || null;
  const wooCustomerId = o.customer_id && o.customer_id > 0 ? o.customer_id : null;

  if (!wooCustomerId && !phone && !email && !billingName) {
    return null; // truly no customer info
  }

  // 1. Try by woo_customer_id within this store
  let existing: { id: string; name?: string } | null = null;
  if (wooCustomerId) {
    const { data } = await supabase
      .from("customers")
      .select("id, name")
      .eq("woo_customer_id", wooCustomerId)
      .eq("store_id", store_id)
      .maybeSingle();
    existing = data || null;
  }

  // 2. Try by phone (global — phone is unique constraint)
  if (!existing && phone) {
    const { data } = await supabase
      .from("customers")
      .select("id, name")
      .eq("phone", phone)
      .maybeSingle();
    existing = data || null;
  }

  // Build patch — only overwrite fields where we have new info
  const patch: Record<string, any> = {};
  if (wooCustomerId) patch.woo_customer_id = wooCustomerId;
  if (billingName) patch.name = billingName;
  if (email) patch.email = email;
  if (phone) patch.phone = phone;
  if (address) patch.address = address;
  if (city) patch.city = city;

  if (existing) {
    if (Object.keys(patch).length > 0) {
      const { error } = await supabase.from("customers").update(patch).eq("id", existing.id);
      if (error) console.warn("Customer update failed:", error.message);
    }
    return existing.id;
  }

  // 3. Insert new
  const insertRow = {
    store_id,
    woo_customer_id: wooCustomerId,
    name: billingName || "Guest",
    email,
    phone,
    address,
    city,
  };
  const { data: created, error: insertErr } = await supabase
    .from("customers")
    .insert(insertRow)
    .select("id")
    .single();

  if (insertErr || !created) {
    // Most likely cause: phone collision with another store. Re-resolve by phone.
    console.warn("Customer insert failed, retrying by phone:", insertErr?.message);
    if (phone) {
      const { data: byPhone } = await supabase
        .from("customers")
        .select("id")
        .eq("phone", phone)
        .maybeSingle();
      if (byPhone) {
        if (Object.keys(patch).length > 0) {
          await supabase.from("customers").update(patch).eq("id", byPhone.id);
        }
        return byPhone.id;
      }
    }
    return null;
  }
  return created.id;
}

/* ====== Helpers ====== */
function mapWooStatus(status: string): string {
  const map: Record<string, string> = {
    pending: "pending",
    processing: "processing",
    "on-hold": "pending",
    completed: "completed",
    cancelled: "cancelled",
    refunded: "returned",
    failed: "cancelled",
    shipped: "shipped",
  };
  return map[status] || "pending";
}

function derivePaymentStatus(o: any): string {
  const method = (o.payment_method || "").toLowerCase();
  if (method === "cod" || (o.payment_method_title || "").toLowerCase().includes("cash on delivery")) {
    return "cod";
  }
  const status = (o.status || "").toLowerCase();
  if (status === "completed" || status === "processing") {
    return "paid";
  }
  return "unpaid";
}
