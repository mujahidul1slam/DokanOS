import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
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
    supabaseInstance = supabase;

    if (action === "push_product" && product_id) {
      return await pushProduct(supabase, product_id);
    } else if (action === "push_order" && order_id) {
      return await pushOrder(supabase, order_id, { include_items: body.include_items === true });
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
    .select("id, woo_product_id, store_id, name, sku, price, regular_price, sale_price, sale_price_from, sale_price_to, description, short_description, attributes, tags, weight, dimensions, stock_quantity, manage_stock, stock_status, image_url, is_active, barcode, backorders")
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
    .select("id, woo_order_id, store_id, status, notes, discount, shipping_cost, total, subtotal, customer_id, customer_name, customer_phone, customer_address, customer_city, customer_email, payment_method")
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

// Phase 4: circuit breaker.
// On a hard failure (bad auth / store offline / timeout) bump the store's
// sync_failures; once it crosses the threshold the store is tripped for an hour
// so the worker stops hammering it. Success resets the counter. The threshold
// (5) and 1-hour cooldown are enforced in the SQL RPCs
// (bump_store_sync_failure / reset_store_circuit_breaker).
const BREAKER_THRESHOLD = 5;

async function recordCircuitResult(supabase: any, storeId: string | undefined, failed: boolean) {
  if (!storeId) return;
  if (!failed) {
    await supabase.rpc("reset_store_circuit_breaker", { p_store_id: storeId });
    return;
  }
  const { error } = await supabase.rpc("bump_store_sync_failure", { p_store_id: storeId });
  if (error) console.warn("circuit breaker bump failed:", error.message);
}

// Retrying fetch for WooCommerce writes.
// 429 / 502 / 503 / 504 are transient: back off (respecting Retry-After when
// Woo sends it) and retry instead of hard-failing the queue row and feeding
// the store's circuit breaker with spurious failures. Network errors throw
// (the caller's catch records the breaker bump).
const WOO_RETRIES = 3;

async function wooPutWithRetry(url: string, body: any, storeId: string): Promise<Response> {
  let lastRes: Response | null = null;
  for (let attempt = 0; attempt <= WOO_RETRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "PUT",
        headers: { Authorization: currentAuthHeader, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      if (attempt === WOO_RETRIES) throw err;
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
      continue;
    }
    if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) {
      const retryAfter = parseInt(res.headers.get("retry-after") || "", 10);
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 30000)
        : Math.min(2000 * Math.pow(2, attempt), 15000);
      console.warn(`[woo-push] ${res.status} on PUT (attempt ${attempt + 1}) — waiting ${waitMs}ms`);
      lastRes = res;
      if (attempt === WOO_RETRIES) break;
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }
    return res;
  }
  // Exhausted retries on a transient status — still a store-side problem:
  // report it to the breaker so a persistently unhealthy store trips.
  await recordCircuitResult(supabaseInstance, storeId, true);
  return lastRes!;
}

// Auth header captured per-request (woo-push is single-action per invocation).
let currentAuthHeader = "";

async function fetchWithBreaker(url: string, opts: any, storeId: string | undefined): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    // Network-level failure (DNS, TLS, timeout) — treat as store offline.
    await recordCircuitResult(supabaseInstance, storeId, true);
    throw err;
  }
  // 401 = bad credentials, 502/503/504 = store offline / gateway error.
  if (res.status === 401 || res.status === 502 || res.status === 503 || res.status === 504) {
    await recordCircuitResult(supabaseInstance, storeId, true);
  } else if (res.ok) {
    await recordCircuitResult(supabaseInstance, storeId, false);
  }
  return res;
}

// Captured after client creation so fetchWithBreaker can reach it.
let supabaseInstance: any = null;

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
  currentAuthHeader = wooAuth(store);

  // Build WooCommerce product payload.
  // Pricing (Issue 5): regular_price comes from the dedicated column (only
  // falling back to `price` for pre-migration rows); sale_price is only
  // pushed when set, so Woo sale structures survive DokanOS edits.
  const regular = product.regular_price != null && Number(product.regular_price) > 0
    ? Number(product.regular_price)
    : Number(product.price) || 0;

  const wooPayload: any = {
    name: product.name,
    sku: product.sku || "",
    regular_price: String(regular),
    // Description goes back to its own field (old code wrote the imported
    // short_description into Woo's long description, corrupting it).
    description: product.description || "",
    short_description: product.short_description || "",
    manage_stock: product.manage_stock,
    stock_quantity: product.manage_stock ? product.stock_quantity : null,
    stock_status: toWooStockStatus(product.stock_status),
    backorders: product.backorders || "no",
    status: product.is_active ? "publish" : "draft",
    meta_data: [{ key: "_dokan_origin", value: "true" }],
  };

  if (product.sale_price != null && Number(product.sale_price) > 0) {
    wooPayload.sale_price = String(Number(product.sale_price));
    if (product.sale_price_from) wooPayload.date_on_sale_from_gmt = product.sale_price_from;
    if (product.sale_price_to) wooPayload.date_on_sale_to_gmt = product.sale_price_to;
  } else {
    // Clear any lingering sale on Woo when DokanOS has none.
    wooPayload.sale_price = "";
  }

  // Parent-level attributes (Issue 5): stored as jsonb, pushed back in Woo's
  // expected shape. Taxonomy ids are preserved when present so Woo keeps
  // global attributes linked; local-only attrs push with id=0 (new term).
  if (Array.isArray(product.attributes) && product.attributes.length > 0) {
    wooPayload.attributes = (product.attributes as any[]).map((a) => ({
      id: a.id ?? 0,
      name: a.name || a.slug || "",
      slug: a.slug || "",
      position: a.position ?? 0,
      visible: a.visible ?? true,
      variation: a.variation ?? false,
      options: Array.isArray(a.options) ? a.options.map((o: any) => String(o)) : [],
    }));
  }

  if (Array.isArray(product.tags) && product.tags.length > 0) {
    wooPayload.tags = (product.tags as any[]).map((t) => ({ id: t.id, name: t.name, slug: t.slug }));
  }

  if (product.weight != null && Number(product.weight) > 0) {
    wooPayload.weight = String(product.weight);
  }

  if (product.dimensions && (product.dimensions.length || product.dimensions.width || product.dimensions.height)) {
    wooPayload.dimensions = {
      length: product.dimensions.length || "",
      width: product.dimensions.width || "",
      height: product.dimensions.height || "",
    };
  }

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
  const res = await wooPutWithRetry(url, wooPayload, store.id);

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
      // Variation pricing: same sale-structure rule as the parent (Issue 5).
      const vRegular = v.regular_price != null && Number(v.regular_price) > 0
        ? Number(v.regular_price)
        : Number(v.price) || 0;
      const varPayload: any = {
        sku: v.sku || "",
        regular_price: String(vRegular),
        manage_stock: v.manage_stock,
        stock_quantity: v.manage_stock ? v.stock_quantity : null,
        stock_status: toWooStockStatus(v.stock_status),
        meta_data: [{ key: "_dokan_origin", value: "true" }],
      };
      if (v.sale_price != null && Number(v.sale_price) > 0) {
        varPayload.sale_price = String(Number(v.sale_price));
      } else {
        varPayload.sale_price = "";
      }
      const varUrl = `${baseUrl(store)}/wp-json/wc/v3/products/${product.woo_product_id}/variations/${v.woo_variation_id}`;
      const varRes = await wooPutWithRetry(varUrl, varPayload, store.id);
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
  currentAuthHeader = wooAuth(store);

  const wooPayload = {
    manage_stock: product.manage_stock,
    stock_quantity: product.manage_stock ? product.stock_quantity : null,
    stock_status: toWooStockStatus(product.stock_status),
    meta_data: [{ key: "_dokan_origin", value: "true" }],
  };

  const url = `${baseUrl(store)}/wp-json/wc/v3/products/${product.woo_product_id}`;
  const res = await wooPutWithRetry(url, wooPayload, store.id);

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
      const varRes = await wooPutWithRetry(varUrl, {
        manage_stock: v.manage_stock,
        stock_quantity: v.manage_stock ? v.stock_quantity : null,
        stock_status: toWooStockStatus(v.stock_status),
        meta_data: [{ key: "_dokan_origin", value: "true" }],
      }, store.id);
      if (!varRes.ok) {
        console.warn(`Failed to push variation stock ${v.woo_variation_id}: ${varRes.status}`);
      }
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/* ====== PUSH ORDER ====== */
async function pushOrder(supabase: any, orderId: string, opts: any = {}) {
  const ctx = await getStoreForOrder(supabase, orderId);
  if (!ctx) {
    return new Response(JSON.stringify({ success: false, skipped: true, reason: "Order not linked to a WooCommerce store" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { order, store } = ctx;
  currentAuthHeader = wooAuth(store);

  // Map our status back to WooCommerce status
  const wooStatus = reverseMapStatus(order.status);

  // Full-fidelity payload (Issue 1): everything DokanOS mirrors gets pushed.
  // Name is a single field locally -> split into Woo's first/last.
  // Billing/address pushes are always safe (no financial recalculation).
  // NOTE: Woo rejects empty-string email (rest_invalid_email), so the email
  // key is omitted entirely when the order has none — never send "".
  const nameParts = (order.customer_name || "").trim().split(/\s+/);
  const billing: any = {
    first_name: nameParts[0] || "",
    last_name: nameParts.slice(1).join(" "),
    phone: order.customer_phone || "",
    address_1: order.customer_address || "",
    city: order.customer_city || "",
    country: "BD",
  };
  if (order.customer_email && String(order.customer_email).includes("@")) {
    billing.email = order.customer_email;
  }

  const wooPayload: any = {
    status: wooStatus,
    billing,
    shipping: { ...billing },
    meta_data: [{ key: "_dokan_origin", value: "true" }],
  };

  // If order has notes, set customer_note
  if (order.notes) {
    wooPayload.customer_note = order.notes;
  }

  // Financial fields (shipping_lines / fee_lines / line_items) are ONLY pushed
  // on deliberate item edits (include_items). Rationale:
  //   - Status pushes (the bulk of the queue, incl. the delivered backfill)
  //     must never touch order totals.
  //   - DokanOS `discount` mirrors Woo's discount_total, which on Woo's side is
  //     usually produced by COUPONS. Pushing a negative fee line on top of an
  //     active coupon would double-apply the discount. We therefore GET the
  //     Woo order first and only push the fee when no coupons are present.
  if (opts?.include_items) {
    const getUrl = `${baseUrl(store)}/wp-json/wc/v3/orders/${order.woo_order_id}`;
    const getRes = await fetch(getUrl, { headers: { Authorization: currentAuthHeader } });
    let existingCoupons: any[] = [];
    if (getRes.ok) {
      const existing = await getRes.json();
      existingCoupons = existing?.coupon_lines || [];
    }

    // Shipping cost -> real shipping line (replaces Woo's line; totals equal
    // because the value was imported from Woo's shipping_total).
    const shippingCost = Number(order.shipping_cost || 0);
    if (shippingCost > 0) {
      wooPayload.shipping_lines = [{
        method_id: "flat_rate",
        method_title: "Shipping",
        total: String(shippingCost),
      }];
    }

    // Discount -> negative fee line, but ONLY when Woo has no coupons (else
    // the coupon already accounts for it and a fee would double-discount).
    const discount = Number(order.discount || 0);
    if (discount > 0 && existingCoupons.length === 0) {
      wooPayload.fee_lines = [{
        name: "Discount",
        total: String(-discount),
      }];
    }

    // Line items (Issue 1, overwrite mode per product decision): rebuilt from
    // DokanOS order_items joined to their Woo product ids.
    const { data: items } = await supabase
      .from("order_items")
      .select("product_id, product_name, quantity, unit_price")
      .eq("order_id", orderId);
    if (items && items.length > 0) {
      // Resolve Woo ids for all referenced products in one round-trip.
      const prodIds = Array.from(new Set(items.map((i: any) => i.product_id).filter(Boolean)));
      const wooIds = new Map<string, number | null>();
      if (prodIds.length > 0) {
        const { data: prods } = await supabase
          .from("products")
          .select("id, woo_product_id")
          .in("id", prodIds);
        for (const p of prods || []) {
          wooIds.set(p.id, p.woo_product_id);
        }
      }
      wooPayload.line_items = items.map((i: any) => {
        const line: any = { name: i.product_name, quantity: i.quantity, unit_price: String(i.unit_price) };
        const wp = i.product_id ? wooIds.get(i.product_id) : undefined;
        if (wp) {
          line.product_id = wp;
        }
        return line;
      });
    }
  }

  const url = `${baseUrl(store)}/wp-json/wc/v3/orders/${order.woo_order_id}`;
  const res = await wooPutWithRetry(url, wooPayload, store.id);

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
    payment_pending: "on-hold",
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
    return new Response(JSON.stringify({ success: false, skipped: true, reason: "Order not linked to a WooCommerce store" }), {
      status: 200,
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
