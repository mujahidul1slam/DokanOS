import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-wc-webhook-signature, x-wc-webhook-source, x-wc-webhook-topic",
};

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
    stock_status: p.stock_status || "in_stock",
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
  // Upsert customer
  let customer_id: string | null = null;
  const hasCustomerInfo = o.billing?.phone || o.billing?.first_name || o.billing?.email;

  if (o.customer_id && o.customer_id > 0) {
    const custData = {
      store_id,
      woo_customer_id: o.customer_id,
      name: `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim() || "Guest",
      email: o.billing?.email || null,
      phone: o.billing?.phone || null,
      address: [o.billing?.address_1, o.billing?.address_2].filter(Boolean).join(", ") || null,
      city: o.billing?.city || null,
    };

    const { data: existingCust } = await supabase
      .from("customers")
      .select("id")
      .eq("woo_customer_id", o.customer_id)
      .eq("store_id", store_id)
      .maybeSingle();

    if (existingCust) {
      await supabase.from("customers").update(custData).eq("id", existingCust.id);
      customer_id = existingCust.id;
    } else {
      const { data: newCust } = await supabase
        .from("customers")
        .insert(custData)
        .select("id")
        .single();
      customer_id = newCust?.id || null;
    }
  } else if (hasCustomerInfo) {
    const guestName = `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim() || "Guest";
    const { data: guestCust } = await supabase
      .from("customers")
      .insert({
        store_id,
        name: guestName,
        email: o.billing?.email || null,
        phone: o.billing?.phone || null,
        address: [o.billing?.address_1, o.billing?.address_2].filter(Boolean).join(", ") || null,
        city: o.billing?.city || null,
      })
      .select("id")
      .single();
    customer_id = guestCust?.id || null;
  }

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
