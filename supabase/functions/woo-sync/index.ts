import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { store_id, sync_customers: forceCustomers = false } = await req.json();
    if (!store_id) {
      return new Response(JSON.stringify({ error: "store_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: store, error: storeErr } = await supabase
      .from("stores").select("*").eq("id", store_id).single();

    if (storeErr || !store) {
      return new Response(JSON.stringify({ error: "Store not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!store.consumer_key || !store.consumer_secret) {
      return new Response(JSON.stringify({ error: "Store missing API credentials" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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

    async function wooFetchAll(endpoint: string, params: Record<string, string> = {}) {
      const all: any[] = [];
      let page = 1;
      const extra = Object.entries(params).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join("");
      while (true) {
        const url = `${baseUrl}/wp-json/wc/v3/${endpoint}?per_page=100&page=${page}${extra}`;
        const res = await wooFetchWithRetry(url);
        if (!res.ok) {
          const text = await res.text();
          // 400 with "rest_post_invalid_page_number" = past the last page; treat as done
          if (res.status === 400 && text.includes("rest_post_invalid_page_number")) break;
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

    // Run async tasks with bounded concurrency.
    async function pMap<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
      const results: R[] = new Array(items.length);
      let next = 0;
      const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (true) {
          const i = next++;
          if (i >= items.length) return;
          results[i] = await fn(items[i], i);
        }
      });
      await Promise.all(workers);
      return results;
    }

    const summary = { products: 0, orders: 0, order_items: 0, customers: 0, categories: 0, variations: 0 };
    const t0 = Date.now();
    const ts = (label: string) => console.log(`[woo-sync ${store_id.slice(0, 8)}] ${label} (+${((Date.now() - t0) / 1000).toFixed(1)}s)`);

    // Stale-lock guard: if a sync is marked "syncing" but stores.updated_at hasn't moved in 10+ minutes,
    // the previous run died — allow this one to take over.
    if (store.status === "syncing") {
      const updatedAt = store.updated_at ? new Date(store.updated_at).getTime() : 0;
      const ageMin = (Date.now() - updatedAt) / 60000;
      if (ageMin < 10) {
        return new Response(
          JSON.stringify({ success: true, status: "already_running", message: `A sync is already in progress for this store (started ${ageMin.toFixed(1)}m ago).` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      console.warn(`Stale sync lock detected (${ageMin.toFixed(1)}m old) — taking over.`);
    }

    await supabase.from("stores").update({ status: "syncing" }).eq("id", store_id);

    // Heartbeat: bump updated_at every 30s so the stale-lock guard knows we're alive
    const heartbeat = setInterval(() => {
      supabase.from("stores").update({ updated_at: new Date().toISOString() }).eq("id", store_id).then();
    }, 30000);

    const syncTask = (async () => {
      try {
        await runFullSync();
        await supabase.from("stores")
          .update({ status: "connected", last_synced_at: new Date().toISOString() })
          .eq("id", store_id);
        ts(`completed: ${JSON.stringify(summary)}`);
      } catch (e: any) {
        console.error("woo-sync background error:", e?.message || e);
        await supabase.from("stores").update({ status: "error" }).eq("id", store_id);
      } finally {
        clearInterval(heartbeat);
      }
    })();

    // @ts-ignore
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(syncTask);
    }

    return new Response(
      JSON.stringify({ success: true, status: "started", message: "Sync running in background. Check back in a minute." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

    async function upsertAliases(customerId: string, name: string | null, email: string | null, address: string | null, city: string | null) {
      const aliasRows: any[] = [];
      if (name) aliasRows.push({ customer_id: customerId, type: "name", value: name, source_store_id: store_id });
      if (email) aliasRows.push({ customer_id: customerId, type: "email", value: email, source_store_id: store_id });
      const fullAddr = [address, city].filter(Boolean).join(", ");
      if (fullAddr) aliasRows.push({ customer_id: customerId, type: "address", value: fullAddr, source_store_id: store_id });
      for (const row of aliasRows) {
        const { error } = await supabase.from("customer_aliases").insert(row);
        if (error && !String(error.message || "").includes("duplicate")) {
          console.warn("Alias insert warn:", error.message);
        }
      }
    }

    function normalizePhone(raw: any): string | null {
      if (!raw) return null;
      let p = String(raw).replace(/[^0-9]/g, "");
      if (!p) return null;
      if (p.startsWith("880") && p.length >= 13) p = p.slice(3);
      if (p.length === 10 && p.startsWith("1")) p = "0" + p;
      return p;
    }

    /** Find-or-create customer GLOBALLY by phone (then email). Never overwrites existing. */
    async function findOrCreateCustomer(args: {
      phone: string | null; email: string | null; name: string | null;
      address: string | null; city: string | null; wooCustomerId?: number | null;
    }): Promise<string | null> {
      const { phone: rawPhone, email, name, address, city, wooCustomerId } = args;
      const phone = normalizePhone(rawPhone);
      if (!phone && !email && !name) return null;

      let customerId: string | null = null;
      if (phone) {
        const { data } = await supabase.from("customers").select("id").eq("phone", phone).maybeSingle();
        if (data) customerId = data.id;
      }
      if (!customerId && email) {
        const { data } = await supabase.from("customers").select("id").eq("email", email).maybeSingle();
        if (data) customerId = data.id;
      }
      if (!customerId) {
        const insertRow: any = { store_id, name: name || "Guest", email, phone, address, city };
        if (wooCustomerId) insertRow.woo_customer_id = wooCustomerId;
        const { data: created, error } = await supabase.from("customers").insert(insertRow).select("id").single();
        if (error || !created) {
          if (phone) {
            const { data: retry } = await supabase.from("customers").select("id").eq("phone", phone).maybeSingle();
            if (retry) customerId = retry.id;
          }
          if (!customerId) return null;
        } else {
          customerId = created.id;
        }
      }
      await upsertAliases(customerId, name, email, address, city);
      return customerId;
    }

    async function runFullSync() {
    // --- Sync Categories ---
    const wooCategories = await wooFetchAll("products/categories");
    if (wooCategories.length > 0) {
      const catRows = wooCategories.map((c: any) => ({
        store_id, woo_category_id: c.id, name: c.name, slug: c.slug || "",
      }));

      const { error: catErr } = await supabase
        .from("categories")
        .upsert(catRows, { onConflict: "woo_category_id,store_id", ignoreDuplicates: false });
      if (catErr) console.error("Categories upsert error:", catErr);

      const { data: dbCats } = await supabase
        .from("categories").select("id, woo_category_id").eq("store_id", store_id);
      const catMap = new Map((dbCats || []).map((c: any) => [c.woo_category_id, c.id]));

      for (const wc of wooCategories) {
        if (wc.parent && wc.parent > 0) {
          const dbId = catMap.get(wc.id);
          const parentDbId = catMap.get(wc.parent);
          if (dbId && parentDbId) {
            await supabase.from("categories").update({ parent_id: parentDbId }).eq("id", dbId);
          }
        }
      }
      summary.categories = wooCategories.length;
    }

    const { data: allDbCats } = await supabase
      .from("categories").select("id, woo_category_id").eq("store_id", store_id);
    const catByWooId = new Map((allDbCats || []).map((c: any) => [c.woo_category_id, c.id]));

    // --- Sync Products ---
    const wooProducts = await wooFetchAll("products");
    const parentProducts = wooProducts.filter((p: any) => p.type !== "variation");

    if (parentProducts.length > 0) {
      const rows = parentProducts.map((p: any) => ({
        store_id, woo_product_id: p.id, name: p.name, sku: p.sku || null,
        description: p.short_description || p.description || null,
        price: parseFloat(p.price) || 0,
        cost_price: parseFloat(p.meta_data?.find((m: any) => m.key === "_cost")?.value) || 0,
        stock_quantity: p.stock_quantity ?? 0, manage_stock: p.manage_stock ?? false,
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

      const { data: dbProds } = await supabase
        .from("products").select("id, woo_product_id").eq("store_id", store_id);
      const prodByWooId = new Map((dbProds || []).map((p: any) => [p.woo_product_id, p.id]));

      const pcRows: { product_id: string; category_id: string }[] = [];
      const productIdsWithCats: string[] = [];
      for (const wp of parentProducts) {
        const prodId = prodByWooId.get(wp.id);
        if (!prodId) continue;
        productIdsWithCats.push(prodId);
        for (const wc of wp.categories || []) {
          const catId = catByWooId.get(wc.id);
          if (catId) pcRows.push({ product_id: prodId, category_id: catId });
        }
      }
      if (productIdsWithCats.length > 0) {
        await supabase.from("product_categories").delete().in("product_id", productIdsWithCats);
      }
      if (pcRows.length > 0) {
        for (let i = 0; i < pcRows.length; i += 500) {
          await supabase.from("product_categories").insert(pcRows.slice(i, i + 500));
        }
      }

      // Fetch variations for ALL variable products. Don't trust `wp.variations?.length`
      // — some WC setups omit/under-report it. Always hit the variations endpoint.
      const variableProducts = parentProducts.filter((wp: any) => wp.type === "variable");
      for (let vi = 0; vi < variableProducts.length; vi++) {
        const wp = variableProducts[vi];
        const prodId = prodByWooId.get(wp.id);
        if (!prodId) continue;
        if (vi > 0) await delay(300);
        try {
          // Paginate variations (WC default is 10/page; per_page=100 max)
          const wooVars: any[] = [];
          let vpage = 1;
          while (true) {
            const chunk = await wooFetch(`products/${wp.id}/variations?per_page=100&page=${vpage}`);
            if (!Array.isArray(chunk) || chunk.length === 0) break;
            wooVars.push(...chunk);
            if (chunk.length < 100) break;
            vpage++;
          }
          if (wooVars.length === 0) {
            console.warn(`Variable product ${wp.id} (${wp.name}) returned 0 variations from WC`);
            continue;
          }

          const varRows = wooVars.map((v: any) => ({
            product_id: prodId, woo_variation_id: v.id,
            name: v.attributes?.map((a: any) => a.option).join(" / ") || `Variation ${v.id}`,
            sku: v.sku || null, price: parseFloat(v.price) || 0,
            manage_stock: v.manage_stock ?? false, stock_quantity: v.stock_quantity ?? 0,
            stock_status: fromWooStockStatus(v.stock_status || "instock"),
            barcode: v.meta_data?.find((m: any) => m.key === "_barcode")?.value || null,
            attributes: (v.attributes || []).map((a: any) => ({ key: a.name || a.slug, value: a.option })),
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

    // --- Sync Customers (ONE-WAY, ONE-TIME) ---
    // Only on FIRST Sync Now per store, OR when explicitly forced via "Sync Customers" button.
    // Identity = phone, GLOBAL across stores. Existing customers are NEVER overwritten;
    // every new name/email/address gets appended as an alias.
    const shouldSyncCustomers = forceCustomers || !store.customers_synced_at;

    if (shouldSyncCustomers) {
      const wooCustomers = await wooFetchAll("customers");
      let okCount = 0;
      for (const c of wooCustomers) {
        const phone = c.billing?.phone?.trim() || null;
        const email = c.email?.trim() || null;
        const name = `${c.first_name || ""} ${c.last_name || ""}`.trim() || c.username || "Guest";
        const address = [c.billing?.address_1, c.billing?.address_2].filter(Boolean).join(", ") || null;
        const city = c.billing?.city || null;
        const id = await findOrCreateCustomer({ phone, email, name, address, city, wooCustomerId: c.id });
        if (id) okCount++;
      }
      summary.customers = okCount;
      await supabase.from("stores").update({ customers_synced_at: new Date().toISOString() }).eq("id", store_id);
    } else {
      console.log(`Skipping customer sync — already done for store ${store_id}. Use "Sync Customers" to force.`);
    }

    // --- Sync Orders ---
    const wooOrders = await wooFetchAll("orders");
    if (wooOrders.length > 0) {
      // Resolve customer for each order (creates per-order if new phone arrives via webhook/sync).
      const orderCustomerMap = new Map<number, string | null>();
      for (const o of wooOrders) {
        const phone = o.billing?.phone?.trim() || null;
        const email = o.billing?.email?.trim() || null;
        const billingName = `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim() || null;
        const address = [o.billing?.address_1, o.billing?.address_2].filter(Boolean).join(", ") || null;
        const city = o.billing?.city || null;
        const id = await findOrCreateCustomer({ phone, email, name: billingName, address, city });
        orderCustomerMap.set(o.id, id);
      }

      const { data: dbProducts } = await supabase
        .from("products").select("id, woo_product_id").eq("store_id", store_id);
      const prodMap = new Map((dbProducts || []).map((p: any) => [p.woo_product_id, p.id]));

      const orderRows = wooOrders.map((o: any) => {
        const phone = normalizePhone(o.billing?.phone);
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
          fulfillment_type: fromWooShipping(o),
          subtotal: parseFloat(o.total) - parseFloat(o.shipping_total || "0") + parseFloat(o.discount_total || "0"),
          discount: parseFloat(o.discount_total) || 0,
          shipping_cost: parseFloat(o.shipping_total) || 0,
          total: parseFloat(o.total) || 0,
          customer_id: orderCustomerMap.get(o.id) || null,
          customer_name: billingName || null,
          customer_phone: phone,
          customer_email: o.billing?.email || null,
          customer_address: billingAddr,
          customer_city: o.billing?.city || null,
          notes: o.customer_note || null,
          created_at: o.date_created_gmt ? o.date_created_gmt + "Z" : undefined,
        };
      });

      // Find which orders are new (don't exist yet) so we can write a "created" timeline event after upsert
      const wooIds = wooOrders.map((o: any) => o.id);
      const { data: preExisting } = await supabase
        .from("orders")
        .select("woo_order_id")
        .eq("store_id", store_id)
        .in("woo_order_id", wooIds);
      const preExistingIds = new Set((preExisting || []).map((r: any) => r.woo_order_id));
      const newWooOrders = wooOrders.filter((o: any) => !preExistingIds.has(o.id));

      for (let i = 0; i < orderRows.length; i += 500) {
        const chunk = orderRows.slice(i, i + 500);
        const { error } = await supabase
          .from("orders")
          .upsert(chunk, { onConflict: "woo_order_id,store_id", ignoreDuplicates: false });
        if (error) console.error("Orders upsert error:", error);
      }
      summary.orders = orderRows.length;

      const { data: dbOrders } = await supabase
        .from("orders").select("id, woo_order_id").eq("store_id", store_id);
      const orderMap = new Map((dbOrders || []).map((o: any) => [o.woo_order_id, o.id]));

      // Insert "created" timeline events for newly imported orders
      if (newWooOrders.length > 0) {
        const newTimelineRows = newWooOrders
          .map((o: any) => {
            const orderId = orderMap.get(o.id);
            if (!orderId) return null;
            return {
              order_id: orderId,
              event: "created",
              description: `Order received from WooCommerce — Total ৳${(parseFloat(o.total) || 0).toLocaleString()}`,
              metadata: {
                source: "woo_sync",
                woo_order_id: o.id,
                woo_status: o.status,
                total: parseFloat(o.total) || 0,
                user_name: "WooCommerce",
                user_email: null,
              },
            };
          })
          .filter(Boolean);
        if (newTimelineRows.length > 0) {
          for (let i = 0; i < newTimelineRows.length; i += 500) {
            const chunk = newTimelineRows.slice(i, i + 500);
            const { error: tlErr } = await supabase.from("order_timeline").insert(chunk);
            if (tlErr) console.warn("Timeline insert warn:", tlErr.message);
          }
        }
      }

      let itemCount = 0;
      // Load measurement field name -> group info map for Woo meta detection
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

      for (const o of wooOrders) {
        const orderId = orderMap.get(o.id);
        if (!orderId) continue;
        const items = (o.line_items || []).map((li: any) => {
          const variationLabel = buildVariationLabel(li.meta_data || [], fieldMap);
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
        await supabase.from("order_items").delete().eq("order_id", orderId);
        await supabase.from("order_item_measurements").delete().eq("order_id", orderId).eq("source", "woo");
        let insertedItems: any[] = [];
        if (items.length > 0) {
          const { data: ins, error: itemErr } = await supabase.from("order_items").insert(items).select("id");
          if (itemErr) console.error(`Order items insert error for order ${o.id}:`, itemErr);
          else { itemCount += items.length; insertedItems = ins || []; }
        }

        // Extract measurements from line item meta_data
        const measRows: any[] = [];
        (o.line_items || []).forEach((li: any, idx: number) => {
          const dbItem = insertedItems[idx];
          const groups = extractMeasurementsFromMeta(li.meta_data || [], fieldMap);
          groups.forEach((g) => {
            measRows.push({
              order_id: orderId, order_item_id: dbItem?.id || null,
              group_name: g.groupName, display_format: g.displayFormat,
              unit: g.unit, values: g.values, source: "woo",
            });
          });
        });
        const orderGroups = extractMeasurementsFromMeta(o.meta_data || [], fieldMap);
        orderGroups.forEach((g) => {
          measRows.push({
            order_id: orderId, order_item_id: null,
            group_name: g.groupName, display_format: g.displayFormat,
            unit: g.unit, values: g.values, source: "woo",
          });
        });
        if (measRows.length > 0) {
          const { error: mErr } = await supabase.from("order_item_measurements").insert(measRows);
          if (mErr) console.warn(`Measurements insert warn for order ${o.id}:`, mErr.message);
        }
      }
      summary.order_items = itemCount;
    }
    } // end runFullSync
  } catch (err: any) {
    console.error("woo-sync error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function mapWooStatus(status: string): string {
  const map: Record<string, string> = {
    pending: "pending", processing: "processing", "on-hold": "pending",
    completed: "completed", cancelled: "cancelled", refunded: "returned",
    failed: "cancelled", shipped: "shipped",
  };
  return map[status] || "pending";
}

function fromWooStockStatus(status: string): string {
  const map: Record<string, string> = {
    instock: "in_stock", outofstock: "out_of_stock", onbackorder: "on_backorder",
  };
  return map[status] || status;
}

function derivePaymentStatus(o: any): string {
  const method = (o.payment_method || "").toLowerCase();
  const status = (o.status || "").toLowerCase();
  if (method === "cod" || (o.payment_method_title || "").toLowerCase().includes("cash on delivery")) return "cod";
  if (status === "completed" || status === "processing") return "paid";
  return "unpaid";
}

/** Maps a WooCommerce order's shipping_lines into our fulfillment_type. */
function fromWooShipping(o: any): string {
  const lines = Array.isArray(o?.shipping_lines) ? o.shipping_lines : [];
  if (lines.length === 0) return "delivery";
  const title = String(lines[0]?.method_title || "").toLowerCase();
  const id = String(lines[0]?.method_id || "").toLowerCase();
  if (title.includes("pickup") || title.includes("showroom") || id.includes("pickup") || id.includes("local_pickup")) {
    return "pickup";
  }
  return "delivery";
}

/**
 * Scan WooCommerce meta_data for entries whose key matches a known measurement field name.
 * Skips hidden meta (keys starting with `_`) and entries with empty values.
 * Returns measurements grouped by their parent measurement_group.
 */
function extractMeasurementsFromMeta(
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

/**
 * Build a variation suffix from Woo line item meta_data (e.g., "Size: M / Color: Red").
 * Skips hidden meta (keys starting with `_`) and any keys that match measurement fields.
 */
function buildVariationLabel(
  meta: any[],
  fieldMap: Map<string, { groupName: string; displayFormat: string; unit: string; fieldName: string }>
): string {
  if (!Array.isArray(meta) || meta.length === 0) return "";
  const parts: string[] = [];
  for (const m of meta) {
    const rawKey = String(m?.display_key ?? m?.key ?? "").trim();
    if (!rawKey || rawKey.startsWith("_")) continue;
    if (fieldMap.has(rawKey.toLowerCase())) continue; // skip measurement fields
    const value = String(m?.display_value ?? m?.value ?? "").trim();
    if (!value || value.includes("<")) continue; // skip empty / HTML values
    parts.push(`${rawKey}: ${value}`);
  }
  return parts.join(" / ");
}
