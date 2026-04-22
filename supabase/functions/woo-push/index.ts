import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, product_id, order_id, note, customer_note } = body;

    if (!action) {
      return new Response(JSON.stringify({ error: "action is required (push_product, push_order, push_stock, trash_order, post_note)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    if (action === "push_product" && product_id) {
      return await pushProduct(supabase, product_id);
    } else if (action === "push_order" && order_id) {
      return await pushOrder(supabase, order_id);
    } else if (action === "push_stock" && product_id) {
      return await pushStock(supabase, product_id);
    } else if (action === "trash_order" && order_id) {
      return await trashOrder(supabase, order_id);
    } else if (action === "post_note" && order_id && note) {
      return await postOrderNote(supabase, order_id, String(note), Boolean(customer_note));
    }

    return new Response(JSON.stringify({ error: "Invalid action or missing ID" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("woo-push error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/* ====== Helper: get store credentials ====== */
async function getStoreForProduct(supabase: any, productId: string) {
  const { data: product } = await supabase
    .from("products")
    .select("id, woo_product_id, store_id, name, sku, price, description, stock_quantity, manage_stock, stock_status, image_url, is_active, barcode, backorders")
    .eq("id", productId)
    .single();
  if (!product || !product.store_id || !product.woo_product_id) return null;

  const { data: store } = await supabase
    .from("stores")
    .select("id, url, consumer_key, consumer_secret")
    .eq("id", product.store_id)
    .single();
  if (!store || !store.consumer_key || !store.consumer_secret) return null;

  return { product, store };
}

async function getStoreForOrder(supabase: any, orderId: string) {
  const { data: order } = await supabase
    .from("orders")
    .select("id, woo_order_id, store_id, status, notes, discount, shipping_cost, total, subtotal, customer_id")
    .eq("id", orderId)
    .single();
  if (!order || !order.store_id || !order.woo_order_id) return null;

  const { data: store } = await supabase
    .from("stores")
    .select("id, url, consumer_key, consumer_secret")
    .eq("id", order.store_id)
    .single();
  if (!store || !store.consumer_key || !store.consumer_secret) return null;

  return { order, store };
}

function wooAuth(store: any) {
  return "Basic " + btoa(`${store.consumer_key}:${store.consumer_secret}`);
}

function baseUrl(store: any) {
  return store.url.replace(/\/+$/, "");
}

/** Convert DB stock_status to WooCommerce format — handles both formats gracefully */
function toWooStockStatus(status: string): string {
  const map: Record<string, string> = {
    in_stock: "instock",
    out_of_stock: "outofstock",
    on_backorder: "onbackorder",
    // Pass through if already in WooCommerce format
    instock: "instock",
    outofstock: "outofstock",
    onbackorder: "onbackorder",
  };
  return map[status] || "instock";
}

/* ====== PUSH PRODUCT ====== */
async function pushProduct(supabase: any, productId: string) {
  const ctx = await getStoreForProduct(supabase, productId);
  if (!ctx) {
    return new Response(JSON.stringify({ error: "Product not linked to a WooCommerce store or missing credentials" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { product, store } = ctx;

  // Build WooCommerce product payload
  const wooPayload: any = {
    name: product.name,
    sku: product.sku || "",
    regular_price: String(product.price),
    description: product.description || "",
    manage_stock: product.manage_stock,
    stock_quantity: product.manage_stock ? product.stock_quantity : null,
    stock_status: toWooStockStatus(product.stock_status),
    backorders: product.backorders || "no",
    status: product.is_active ? "publish" : "draft",
  };

  // Push categories
  const { data: pcData } = await supabase
    .from("product_categories")
    .select("category_id")
    .eq("product_id", productId);
  if (pcData && pcData.length > 0) {
    const catIds = pcData.map((pc: any) => pc.category_id);
    const { data: cats } = await supabase
      .from("categories")
      .select("woo_category_id")
      .in("id", catIds);
    if (cats) {
      wooPayload.categories = cats
        .filter((c: any) => c.woo_category_id)
        .map((c: any) => ({ id: c.woo_category_id }));
    }
  }

  const url = `${baseUrl(store)}/wp-json/wc/v3/products/${product.woo_product_id}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: wooAuth(store),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(wooPayload),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`WooCommerce PUT product error: ${res.status}`, text);
    return new Response(JSON.stringify({ error: `WooCommerce API error: ${res.status}`, details: text }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Also push variations if they exist
  const { data: variations } = await supabase
    .from("product_variations")
    .select("*")
    .eq("product_id", productId);

  if (variations && variations.length > 0) {
    for (const v of variations) {
      if (!v.woo_variation_id) continue;
      const varPayload: any = {
        sku: v.sku || "",
        regular_price: String(v.price),
        manage_stock: v.manage_stock,
        stock_quantity: v.manage_stock ? v.stock_quantity : null,
        stock_status: toWooStockStatus(v.stock_status),
      };
      const varUrl = `${baseUrl(store)}/wp-json/wc/v3/products/${product.woo_product_id}/variations/${v.woo_variation_id}`;
      const varRes = await fetch(varUrl, {
        method: "PUT",
        headers: { Authorization: wooAuth(store), "Content-Type": "application/json" },
        body: JSON.stringify(varPayload),
      });
      if (!varRes.ok) {
        console.warn(`Failed to push variation ${v.woo_variation_id}: ${varRes.status}`);
      }
    }
  }

  const wooData = await res.json();
  return new Response(JSON.stringify({ success: true, woo_product_id: wooData.id }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/* ====== PUSH STOCK (lightweight - only stock fields) ====== */
async function pushStock(supabase: any, productId: string) {
  const ctx = await getStoreForProduct(supabase, productId);
  if (!ctx) {
    return new Response(JSON.stringify({ error: "Product not linked to a WooCommerce store" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { product, store } = ctx;

  const wooPayload = {
    manage_stock: product.manage_stock,
    stock_quantity: product.manage_stock ? product.stock_quantity : null,
    stock_status: toWooStockStatus(product.stock_status),
  };

  const url = `${baseUrl(store)}/wp-json/wc/v3/products/${product.woo_product_id}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: wooAuth(store), "Content-Type": "application/json" },
    body: JSON.stringify(wooPayload),
  });

  if (!res.ok) {
    const text = await res.text();
    return new Response(JSON.stringify({ error: `WooCommerce API error: ${res.status}`, details: text }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Also push variation stock
  const { data: variations } = await supabase
    .from("product_variations")
    .select("woo_variation_id, manage_stock, stock_quantity, stock_status")
    .eq("product_id", productId);

  if (variations) {
    for (const v of variations) {
      if (!v.woo_variation_id) continue;
      const varUrl = `${baseUrl(store)}/wp-json/wc/v3/products/${product.woo_product_id}/variations/${v.woo_variation_id}`;
      await fetch(varUrl, {
        method: "PUT",
        headers: { Authorization: wooAuth(store), "Content-Type": "application/json" },
        body: JSON.stringify({
          manage_stock: v.manage_stock,
          stock_quantity: v.manage_stock ? v.stock_quantity : null,
          stock_status: toWooStockStatus(v.stock_status),
        }),
      });
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/* ====== PUSH ORDER ====== */
async function pushOrder(supabase: any, orderId: string) {
  const ctx = await getStoreForOrder(supabase, orderId);
  if (!ctx) {
    return new Response(JSON.stringify({ error: "Order not linked to a WooCommerce store" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { order, store } = ctx;

  // Map our status back to WooCommerce status
  const wooStatus = reverseMapStatus(order.status);

  const wooPayload: any = {
    status: wooStatus,
  };

  // If order has notes, set customer_note
  if (order.notes) {
    wooPayload.customer_note = order.notes;
  }

  const url = `${baseUrl(store)}/wp-json/wc/v3/orders/${order.woo_order_id}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: wooAuth(store), "Content-Type": "application/json" },
    body: JSON.stringify(wooPayload),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`WooCommerce PUT order error: ${res.status}`, text);
    return new Response(JSON.stringify({ error: `WooCommerce API error: ${res.status}`, details: text }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const wooData = await res.json();
  return new Response(JSON.stringify({ success: true, woo_order_id: wooData.id }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function reverseMapStatus(status: string): string {
  // Once a Pathao courier cycle has terminated (delivered OR returned/cancelled/refused),
  // we always close the WooCommerce order as "completed" per business rule —
  // the merchant treats the courier outcome as the final lifecycle event.
  // Pre-order states map to "on-hold" on Woo so customers see production is in progress.
  const map: Record<string, string> = {
    pending: "pending",
    processing: "processing",
    pre_order_pending: "on-hold",
    pre_order_making: "on-hold",
    pre_order_ready: "processing",
    ready_to_ship: "processing",
    completed: "completed",
    delivered: "completed",
    shipped: "completed",
    cancelled: "cancelled",
    returned: "completed",
  };
  return map[status] || "processing";
}

/* ====== TRASH ORDER in WooCommerce ====== */
async function trashOrder(supabase: any, orderId: string) {
  const ctx = await getStoreForOrder(supabase, orderId);
  if (!ctx) {
    return new Response(JSON.stringify({ error: "Order not linked to a WooCommerce store" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { order, store } = ctx;

  // DELETE with force=false moves to trash in WooCommerce
  const url = `${baseUrl(store)}/wp-json/wc/v3/orders/${order.woo_order_id}?force=false`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: wooAuth(store), "Content-Type": "application/json" },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`WooCommerce trash order error: ${res.status}`, text);
    return new Response(JSON.stringify({ error: `WooCommerce API error: ${res.status}` }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/* ====== POST ORDER NOTE in WooCommerce ====== */
async function postOrderNote(supabase: any, orderId: string, note: string, customerNote: boolean) {
  const ctx = await getStoreForOrder(supabase, orderId);
  if (!ctx) {
    return new Response(JSON.stringify({ success: false, skipped: true, reason: "Order not linked to a WooCommerce store" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { order, store } = ctx;
  const url = `${baseUrl(store)}/wp-json/wc/v3/orders/${order.woo_order_id}/notes`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: wooAuth(store), "Content-Type": "application/json" },
    body: JSON.stringify({ note, customer_note: customerNote, added_by_user: false }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`WooCommerce post note error: ${res.status}`, text);
    return new Response(JSON.stringify({ error: `WooCommerce API error: ${res.status}`, details: text }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const data = await res.json();
  return new Response(JSON.stringify({ success: true, note_id: data.id }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
