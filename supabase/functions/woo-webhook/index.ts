import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-wc-webhook-signature, x-wc-webhook-source, x-wc-webhook-topic",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.text();

    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = JSON.parse(body);

    // WooCommerce sends a ping on webhook creation — ignore it
    if (payload.webhook_id && !payload.line_items && !payload.name && !payload.sku) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
      return new Response(JSON.stringify({ error: "Unknown store" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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

    return new Response(JSON.stringify({ ok: true, message: "Unhandled topic" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("woo-webhook error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/* ====== PRODUCT WEBHOOK ====== */
async function handleProductWebhook(supabase: any, store_id: string, p: any) {
  // Upsert product
  const productRow = {
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

  const { data: upsertedProduct, error: prodErr } = await supabase
    .from("products")
    .upsert(productRow, { onConflict: "woo_product_id,store_id" })
    .select("id")
    .single();

  if (prodErr || !upsertedProduct) {
    console.error("Product upsert error:", prodErr);
    return new Response(JSON.stringify({ error: "Failed to save product" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const productId = upsertedProduct.id;

  // Sync categories (many-to-many)
  if (p.categories && Array.isArray(p.categories)) {
    // Get category mappings
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

  // Sync variations if variable product
  if (p.type === "variable" && Array.isArray(p.variations) && p.variations.length > 0) {
    // Note: The product webhook only sends variation IDs, not full data
    // Full variation data comes through separate variation webhooks or needs an API call
    // For now we just mark this — full variation sync happens via woo-sync
    console.log(`Variable product ${p.id} has ${p.variations.length} variations — full sync via woo-sync`);
  }

  return new Response(JSON.stringify({ success: true, product_id: productId }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/* ====== ORDER WEBHOOK ====== */
async function handleOrderWebhook(supabase: any, store_id: string, o: any) {
  // Upsert customer
  let customer_id: string | null = null;
  const hasCustomerInfo = o.billing?.phone || o.billing?.first_name || o.billing?.email;

  if (o.customer_id && o.customer_id > 0) {
    const custRow = {
      store_id,
      woo_customer_id: o.customer_id,
      name: `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim() || "Guest",
      email: o.billing?.email || null,
      phone: o.billing?.phone || null,
      address: [o.billing?.address_1, o.billing?.address_2].filter(Boolean).join(", ") || null,
      city: o.billing?.city || null,
    };
    const { data: cust } = await supabase
      .from("customers")
      .upsert(custRow, { onConflict: "woo_customer_id,store_id" })
      .select("id")
      .single();
    customer_id = cust?.id || null;
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

  const orderRow = {
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
    created_at: o.date_created_gmt ? o.date_created_gmt + "Z" : undefined,
  };

  const { data: upsertedOrder, error: orderErr } = await supabase
    .from("orders")
    .upsert(orderRow, { onConflict: "woo_order_id,store_id" })
    .select("id")
    .single();

  if (orderErr || !upsertedOrder) {
    console.error("Order upsert error:", orderErr);
    return new Response(JSON.stringify({ error: "Failed to save order" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Delete old items and insert new
  await supabase.from("order_items").delete().eq("order_id", upsertedOrder.id);

  const items = (o.line_items || []).map((li: any) => ({
    order_id: upsertedOrder.id,
    product_id: prodMap.get(li.product_id) || null,
    product_name: li.name,
    quantity: li.quantity,
    unit_price: parseFloat(li.price) || 0,
    line_total: parseFloat(li.total) || 0,
  }));

  if (items.length > 0) {
    await supabase.from("order_items").insert(items);
  }

  return new Response(JSON.stringify({ success: true, order_id: upsertedOrder.id }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
