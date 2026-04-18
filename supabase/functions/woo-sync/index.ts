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
    const { store_id, sync_customers: forceCustomers = false } = await req.json();
    if (!store_id) {
      return new Response(JSON.stringify({ error: "store_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: store, error: storeErr } = await supabase
      .from("stores")
      .select("*")
      .eq("id", store_id)
      .single();

    if (storeErr || !store) {
      return new Response(JSON.stringify({ error: "Store not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!store.consumer_key || !store.consumer_secret) {
      return new Response(
        JSON.stringify({ error: "Store missing API credentials" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const baseUrl = store.url.replace(/\/+$/, "");
    const authHeader = "Basic " + btoa(`${store.consumer_key}:${store.consumer_secret}`);

    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

    async function wooFetchWithRetry(url: string, retries = 3): Promise<Response> {
      for (let attempt = 0; attempt <= retries; attempt++) {
        const res = await fetch(url, { headers: { Authorization: authHeader } });
        if (res.status === 429) {
          const wait = Math.min(2000 * Math.pow(2, attempt), 15000);
          console.warn(`Rate limited on ${url}, waiting ${wait}ms (attempt ${attempt + 1})`);
          await delay(wait);
          continue;
        }
        return res;
      }
      throw new Error(`Rate limited after ${retries + 1} attempts: ${url}`);
    }

    async function wooFetchAll(endpoint: string) {
      const all: any[] = [];
      let page = 1;
      while (true) {
        const url = `${baseUrl}/wp-json/wc/v3/${endpoint}?per_page=100&page=${page}`;
        const res = await wooFetchWithRetry(url);
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`WooCommerce API error (${endpoint} p${page}): ${res.status} ${text}`);
        }
        const data = await res.json();
        all.push(...data);
        if (data.length < 100) break;
        page++;
      }
      return all;
    }

    async function wooFetch(endpoint: string) {
      const url = `${baseUrl}/wp-json/wc/v3/${endpoint}`;
      const res = await wooFetchWithRetry(url);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`WooCommerce API error (${endpoint}): ${res.status} ${text}`);
      }
      return res.json();
    }

    const summary = { products: 0, orders: 0, order_items: 0, customers: 0, categories: 0, variations: 0 };

    // If a sync is already running for this store, don't kick off another one.
    if (store.status === "syncing") {
      return new Response(
        JSON.stringify({ success: true, status: "already_running", message: "A sync is already in progress for this store." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mark store as syncing immediately so the UI can poll for completion.
    await supabase.from("stores").update({ status: "syncing" }).eq("id", store_id);

    // Run the heavy sync in the background so the HTTP request doesn't hit the 150s idle timeout.
    const syncTask = (async () => {
      try {
        await runFullSync();
        await supabase
          .from("stores")
          .update({ status: "connected", last_synced_at: new Date().toISOString() })
          .eq("id", store_id);
        console.log("woo-sync completed for store", store_id, summary);
      } catch (e: any) {
        console.error("woo-sync background error:", e?.message || e);
        await supabase
          .from("stores")
          .update({ status: "error" })
          .eq("id", store_id);
      }
    })();

    // @ts-ignore - EdgeRuntime is available in Supabase Edge Runtime
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(syncTask);
    }

    return new Response(
      JSON.stringify({ success: true, status: "started", message: "Sync running in background. Check back in a minute." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

    async function runFullSync() {
    // --- Sync Categories ---
    const wooCategories = await wooFetchAll("products/categories");
    if (wooCategories.length > 0) {
      // First pass: upsert all categories without parent_id
      const catRows = wooCategories.map((c: any) => ({
        store_id,
        woo_category_id: c.id,
        name: c.name,
        slug: c.slug || "",
      }));

      const { error: catErr } = await supabase
        .from("categories")
        .upsert(catRows, { onConflict: "woo_category_id,store_id", ignoreDuplicates: false });
      if (catErr) console.error("Categories upsert error:", catErr);

      // Build lookup of woo_category_id -> db id
      const { data: dbCats } = await supabase
        .from("categories")
        .select("id, woo_category_id")
        .eq("store_id", store_id);
      const catMap = new Map(
        (dbCats || []).map((c: any) => [c.woo_category_id, c.id])
      );

      // Second pass: set parent_id for hierarchical categories
      for (const wc of wooCategories) {
        if (wc.parent && wc.parent > 0) {
          const dbId = catMap.get(wc.id);
          const parentDbId = catMap.get(wc.parent);
          if (dbId && parentDbId) {
            await supabase
              .from("categories")
              .update({ parent_id: parentDbId })
              .eq("id", dbId);
          }
        }
      }
      summary.categories = wooCategories.length;
    }

    // Build category lookup for product mapping
    const { data: allDbCats } = await supabase
      .from("categories")
      .select("id, woo_category_id")
      .eq("store_id", store_id);
    const catByWooId = new Map(
      (allDbCats || []).map((c: any) => [c.woo_category_id, c.id])
    );

    // --- Sync Products ---
    const wooProducts = await wooFetchAll("products");
    // Filter out variations — only keep simple, variable, grouped, external product types
    const parentProducts = wooProducts.filter((p: any) => p.type !== "variation");

    if (parentProducts.length > 0) {
      const rows = parentProducts.map((p: any) => ({
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
      }));

      const { error } = await supabase
        .from("products")
        .upsert(rows, { onConflict: "woo_product_id,store_id", ignoreDuplicates: false });
      if (error) console.error("Products upsert error:", error);
      else summary.products = rows.length;

      // Map product categories (many-to-many)
      const { data: dbProds } = await supabase
        .from("products")
        .select("id, woo_product_id")
        .eq("store_id", store_id);
      const prodByWooId = new Map(
        (dbProds || []).map((p: any) => [p.woo_product_id, p.id])
      );

      // Collect all product_categories rows
      const pcRows: { product_id: string; category_id: string }[] = [];
      const productIdsWithCats: string[] = [];
      for (const wp of parentProducts) {
        const prodId = prodByWooId.get(wp.id);
        if (!prodId) continue;
        productIdsWithCats.push(prodId);
        for (const wc of wp.categories || []) {
          const catId = catByWooId.get(wc.id);
          if (catId) {
            pcRows.push({ product_id: prodId, category_id: catId });
          }
        }
      }

      // Clear old mappings and insert new
      if (productIdsWithCats.length > 0) {
        await supabase.from("product_categories").delete().in("product_id", productIdsWithCats);
      }
      if (pcRows.length > 0) {
        for (let i = 0; i < pcRows.length; i += 500) {
          await supabase.from("product_categories").insert(pcRows.slice(i, i + 500));
        }
      }

      // --- Sync Variations for variable products (with rate limit protection) ---
      const variableProducts = parentProducts.filter((wp: any) => wp.type === "variable" && wp.variations?.length > 0);
      for (let vi = 0; vi < variableProducts.length; vi++) {
        const wp = variableProducts[vi];
        const prodId = prodByWooId.get(wp.id);
        if (!prodId) continue;

        // Throttle: wait 500ms between variation requests to avoid 429
        if (vi > 0) await delay(500);

        try {
          const wooVars = await wooFetch(`products/${wp.id}/variations?per_page=100`);
          if (!Array.isArray(wooVars) || wooVars.length === 0) continue;

          const varRows = wooVars.map((v: any) => ({
            product_id: prodId,
            woo_variation_id: v.id,
            name: v.attributes?.map((a: any) => a.option).join(" / ") || `Variation ${v.id}`,
            sku: v.sku || null,
            price: parseFloat(v.price) || 0,
            manage_stock: v.manage_stock ?? false,
            stock_quantity: v.stock_quantity ?? 0,
            stock_status: fromWooStockStatus(v.stock_status || "instock"),
            barcode: v.meta_data?.find((m: any) => m.key === "_barcode")?.value || null,
            attributes: (v.attributes || []).map((a: any) => ({
              key: a.name || a.slug,
              value: a.option,
            })),
          }));

          const { error: varErr } = await supabase
            .from("product_variations")
            .upsert(varRows, { onConflict: "woo_variation_id,product_id", ignoreDuplicates: false });
          if (varErr) console.error(`Variations upsert error for product ${wp.id}:`, varErr);
          else summary.variations += varRows.length;
        } catch (e: any) {
          console.warn(`Skipping variations for product ${wp.id}: ${e.message}`);
        }
      }
    }

    // --- Sync Customers (per-store; never overwrite cross-store) ---
    // Customers are scoped per store. The same phone can exist in multiple stores.
    // We dedupe within this store on woo_customer_id; phone duplicates within store are
    // prevented by the partial unique index (phone, store_id).
    const wooCustomers = await wooFetchAll("customers");
    if (wooCustomers.length > 0) {
      // Dedupe within batch by phone (last write wins) to avoid intra-batch conflicts on (phone, store_id).
      const seenPhones = new Map<string, any>();
      const rows: any[] = [];
      for (const c of wooCustomers) {
        const phone = c.billing?.phone?.trim() || null;
        const row = {
          store_id,
          woo_customer_id: c.id,
          name: `${c.first_name || ""} ${c.last_name || ""}`.trim() || c.username || "Guest",
          email: c.email || null,
          phone,
          address: [c.billing?.address_1, c.billing?.address_2].filter(Boolean).join(", ") || null,
          city: c.billing?.city || null,
        };
        if (phone) {
          seenPhones.set(phone, row); // keep last
        } else {
          rows.push(row);
        }
      }
      rows.push(...seenPhones.values());

      let okCount = 0;
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        const { error } = await supabase
          .from("customers")
          .upsert(chunk, { onConflict: "woo_customer_id,store_id", ignoreDuplicates: false });
        if (error) {
          console.error("Customers upsert error:", error);
          // Fallback: insert one-by-one, swallowing per-store phone conflicts (existing record stays).
          for (const r of chunk) {
            const { error: insErr } = await supabase.from("customers").insert(r);
            if (!insErr) okCount += 1;
          }
        } else {
          okCount += chunk.length;
        }
      }
      summary.customers = okCount;
    }

    // --- Sync Orders ---
    const wooOrders = await wooFetchAll("orders");
    if (wooOrders.length > 0) {
      // Per-store customer lookup ONLY. Never resolve cross-store by phone — same phone in
      // a different store is treated as a separate customer record.
      const { data: storeCustomers } = await supabase
        .from("customers")
        .select("id, woo_customer_id, phone")
        .eq("store_id", store_id);

      const custByWooId = new Map<number, string>();
      const custByPhone = new Map<string, string>();
      for (const c of (storeCustomers || [])) {
        if (c.woo_customer_id) custByWooId.set(c.woo_customer_id, c.id);
        if (c.phone) custByPhone.set(c.phone, c.id);
      }

      // Create guest customers (per-store) for orders without a linked Woo customer
      // and where no existing customer in THIS store matches the phone.
      for (const o of wooOrders) {
        if ((!o.customer_id || o.customer_id === 0) && (o.billing?.phone || o.billing?.email)) {
          const phone = o.billing?.phone?.trim() || null;
          if (phone && custByPhone.has(phone)) {
            custByWooId.set(-o.id, custByPhone.get(phone)!);
            continue;
          }
          const guestName = `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim() || "Guest";
          const guestRow = {
            store_id,
            name: guestName,
            email: o.billing?.email || null,
            phone,
            address: [o.billing?.address_1, o.billing?.address_2].filter(Boolean).join(", ") || null,
            city: o.billing?.city || null,
          };
          const { data: guestCust, error: gErr } = await supabase
            .from("customers")
            .insert(guestRow)
            .select("id")
            .single();
          if (gErr) {
            // Likely (phone, store_id) collision raced with another insert — re-fetch.
            if (phone) {
              const { data: retry } = await supabase
                .from("customers")
                .select("id")
                .eq("store_id", store_id)
                .eq("phone", phone)
                .maybeSingle();
              if (retry) {
                custByWooId.set(-o.id, retry.id);
                custByPhone.set(phone, retry.id);
              }
            }
            continue;
          }
          if (guestCust) {
            custByWooId.set(-o.id, guestCust.id);
            if (phone) custByPhone.set(phone, guestCust.id);
          }
        }
      }

      const { data: dbProducts } = await supabase
        .from("products")
        .select("id, woo_product_id")
        .eq("store_id", store_id);
      const prodMap = new Map(
        (dbProducts || []).map((p: any) => [p.woo_product_id, p.id])
      );

      const orderRows = wooOrders.map((o: any) => {
        const phone = o.billing?.phone?.trim() || null;
        const customerId =
          (o.customer_id && o.customer_id > 0 ? custByWooId.get(o.customer_id) : null) ||
          custByWooId.get(-o.id) ||
          (phone ? custByPhone.get(phone) : null) ||
          null;
        const billingName = `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim();
        const billingAddr = [o.billing?.address_1, o.billing?.address_2].filter(Boolean).join(", ") || null;

        return {
          store_id,
          woo_order_id: o.id,
          order_number: String(o.number || o.id),
          source: "online",
          status: mapWooStatus(o.status),
          payment_method: o.payment_method_title || o.payment_method || null,
          payment_status: derivePaymentStatus(o),
          subtotal: parseFloat(o.total) - parseFloat(o.shipping_total || "0") + parseFloat(o.discount_total || "0"),
          discount: parseFloat(o.discount_total) || 0,
          shipping_cost: parseFloat(o.shipping_total) || 0,
          total: parseFloat(o.total) || 0,
          customer_id: customerId,
          // Per-order snapshot — frozen at sync time, never derived from customer record.
          customer_name: billingName || null,
          customer_phone: phone,
          customer_email: o.billing?.email || null,
          customer_address: billingAddr,
          customer_city: o.billing?.city || null,
          notes: o.customer_note || null,
          created_at: o.date_created_gmt ? o.date_created_gmt + "Z" : undefined,
        };
      });

      // NOTE: We intentionally do NOT update the linked customer record from order data.
      // Each order carries its own immutable snapshot of billing details. The customers
      // table is only seeded on first encounter (above) — never overwritten by later orders.

      // Upsert orders in chunks
      for (let i = 0; i < orderRows.length; i += 500) {
        const chunk = orderRows.slice(i, i + 500);
        const { error } = await supabase
          .from("orders")
          .upsert(chunk, { onConflict: "woo_order_id,store_id", ignoreDuplicates: false });
        if (error) console.error("Orders upsert error:", error);
      }
      summary.orders = orderRows.length;

      const { data: dbOrders } = await supabase
        .from("orders")
        .select("id, woo_order_id")
        .eq("store_id", store_id);
      const orderMap = new Map(
        (dbOrders || []).map((o: any) => [o.woo_order_id, o.id])
      );

      // Process order items per-order: delete then insert atomically per order to avoid
      // duplication if a sync gets re-triggered. Each line_item is inserted once.
      let itemCount = 0;
      for (const o of wooOrders) {
        const orderId = orderMap.get(o.id);
        if (!orderId) continue;
        const items = (o.line_items || []).map((li: any) => ({
          order_id: orderId,
          product_id: prodMap.get(li.product_id) || null,
          product_name: li.name,
          quantity: li.quantity,
          unit_price: parseFloat(li.price) || 0,
          line_total: parseFloat(li.total) || 0,
        }));
        await supabase.from("order_items").delete().eq("order_id", orderId);
        if (items.length > 0) {
          const { error: itemErr } = await supabase.from("order_items").insert(items);
          if (itemErr) console.error(`Order items insert error for order ${o.id}:`, itemErr);
          else itemCount += items.length;
        }
      }
      summary.order_items = itemCount;
    }
    } // end runFullSync
  } catch (err: any) {
    console.error("woo-sync error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

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

function fromWooStockStatus(status: string): string {
  const map: Record<string, string> = {
    instock: "in_stock",
    outofstock: "out_of_stock",
    onbackorder: "on_backorder",
  };
  return map[status] || status;
}

function derivePaymentStatus(o: any): string {
  const method = (o.payment_method || "").toLowerCase();
  const status = (o.status || "").toLowerCase();
  if (method === "cod" || (o.payment_method_title || "").toLowerCase().includes("cash on delivery")) {
    return "cod";
  }
  if (status === "completed" || status === "processing") {
    return "paid";
  }
  return "unpaid";
}
