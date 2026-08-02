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

    // --- HTTP helpers ----------------------------------------------------
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

    /**
     * Paginated WooCommerce fetch with PARALLELIZED pages.
     * Reads X-WP-TotalPages from page 1, then fetches the rest concurrently.
     * Falls back to sequential walk if the header is missing.
     */
    async function wooFetchAll(endpoint: string, params: Record<string, string> = {}, concurrency = 5) {
      const extra = Object.entries(params).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join("");
      const buildUrl = (page: number) => `${baseUrl}/wp-json/wc/v3/${endpoint}?per_page=100&page=${page}${extra}`;

      // Page 1
      const firstRes = await wooFetchWithRetry(buildUrl(1));
      if (!firstRes.ok) {
        const text = await firstRes.text();
        if (firstRes.status === 400 && text.includes("rest_post_invalid_page_number")) return [];
        throw new Error(`WooCommerce API error (${endpoint} p1): ${firstRes.status} ${text}`);
      }
      const firstData = await firstRes.json();
      if (!Array.isArray(firstData) || firstData.length === 0) return [];

      const totalPagesHeader = firstRes.headers.get("x-wp-totalpages") || firstRes.headers.get("X-WP-TotalPages");
      const totalPages = totalPagesHeader ? parseInt(totalPagesHeader, 10) : null;
      const all: any[] = [...firstData];

      if (totalPages && totalPages > 1) {
        // Parallel fetch remaining pages with bounded concurrency.
        const pages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
        const pageResults: any[][] = new Array(pages.length);
        let cursor = 0;
        const workers = Array.from({ length: Math.min(concurrency, pages.length) }, async () => {
          while (true) {
            const idx = cursor++;
            if (idx >= pages.length) return;
            const p = pages[idx];
            const res = await wooFetchWithRetry(buildUrl(p));
            if (!res.ok) {
              const text = await res.text();
              if (res.status === 400 && text.includes("rest_post_invalid_page_number")) {
                pageResults[idx] = [];
                return;
              }
              throw new Error(`WooCommerce API error (${endpoint} p${p}): ${res.status} ${text}`);
            }
            pageResults[idx] = await res.json();
          }
        });
        await Promise.all(workers);
        for (const arr of pageResults) if (arr?.length) all.push(...arr);
      } else if (firstData.length === 100 && !totalPages) {
        // No header — fall back to sequential walk from page 2.
        let page = 2;
        while (true) {
          const res = await wooFetchWithRetry(buildUrl(page));
          if (!res.ok) {
            const text = await res.text();
            if (res.status === 400 && text.includes("rest_post_invalid_page_number")) break;
            throw new Error(`WooCommerce API error (${endpoint} p${page}): ${res.status} ${text}`);
          }
          const data = await res.json();
          if (!Array.isArray(data) || data.length === 0) break;
          all.push(...data);
          if (data.length < 100) break;
          page++;
        }
      }
      return all;
    }

    /** Bounded-concurrency map. */
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

    /** Fetch all variation pages for a single product in parallel. */
    async function fetchVariationsAll(productId: number, concurrency = 4): Promise<any[]> {
      const buildUrl = (page: number) =>
        `${baseUrl}/wp-json/wc/v3/products/${productId}/variations?per_page=100&page=${page}`;
      const firstRes = await wooFetchWithRetry(buildUrl(1));
      if (!firstRes.ok) {
        const text = await firstRes.text();
        if (firstRes.status === 400 && text.includes("rest_post_invalid_page_number")) return [];
        throw new Error(`Variations error (p${productId}): ${firstRes.status} ${text}`);
      }
      const firstData = await firstRes.json();
      if (!Array.isArray(firstData) || firstData.length === 0) return [];
      const totalPagesHeader = firstRes.headers.get("x-wp-totalpages") || firstRes.headers.get("X-WP-TotalPages");
      const totalPages = totalPagesHeader ? parseInt(totalPagesHeader, 10) : (firstData.length === 100 ? 999 : 1);
      const all = [...firstData];
      if (totalPages > 1) {
        const pages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
        let stop = false;
        let cursor = 0;
        const workers = Array.from({ length: Math.min(concurrency, pages.length) }, async () => {
          while (!stop) {
            const idx = cursor++;
            if (idx >= pages.length) return;
            const p = pages[idx];
            const res = await wooFetchWithRetry(buildUrl(p));
            if (!res.ok) {
              const text = await res.text();
              if (res.status === 400 && text.includes("rest_post_invalid_page_number")) { stop = true; return; }
              throw new Error(`Variations error (p${productId} pg${p}): ${res.status} ${text}`);
            }
            const data = await res.json();
            if (!Array.isArray(data) || data.length === 0) { stop = true; return; }
            all.push(...data);
            if (data.length < 100) stop = true;
          }
        });
        await Promise.all(workers);
      }
      return all;
    }

    const summary = { products: 0, orders: 0, order_items: 0, customers: 0, categories: 0, variations: 0 };
    const t0 = Date.now();
    const ts = (label: string) => console.log(`[woo-sync ${store_id.slice(0, 8)}] ${label} (+${((Date.now() - t0) / 1000).toFixed(1)}s)`);

    // Stale-lock guard
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

    const heartbeat = setInterval(() => {
      supabase.from("stores").update({ updated_at: new Date().toISOString() }).eq("id", store_id).then();
    }, 30000);

    // --- Customer helpers (with in-memory cache) -------------------------
    // NOTE: These MUST be declared before `syncTask` because the background
    // closure references them; otherwise they hit the temporal dead zone.
    /** key (phone or email:xxx) -> customer.id */
    const customerCache = new Map<string, string>();
    /** Tracks alias rows already enqueued/inserted this run to avoid dup work. */
    const aliasSeen = new Set<string>();
    const pendingAliases: any[] = [];

    function queueAliases(customerId: string, name: string | null, email: string | null, address: string | null, city: string | null) {
      const add = (type: string, value: string | null) => {
        if (!value) return;
        const k = `${customerId}|${type}|${value}`;
        if (aliasSeen.has(k)) return;
        aliasSeen.add(k);
        pendingAliases.push({ customer_id: customerId, type, value, source_store_id: store_id });
      };
      add("name", name);
      add("email", email);
      const fullAddr = [address, city].filter(Boolean).join(", ") || null;
      add("address", fullAddr);
    }

    async function flushAliases() {
      if (pendingAliases.length === 0) return;
      // Bulk insert in chunks; ignore duplicates (unique constraint may exist).
      for (let i = 0; i < pendingAliases.length; i += 500) {
        const chunk = pendingAliases.slice(i, i + 500);
        const { error } = await supabase.from("customer_aliases").insert(chunk);
        if (error && !String(error.message || "").toLowerCase().includes("duplicate")) {
          console.warn("Alias bulk insert warn:", error.message);
        }
      }
      pendingAliases.length = 0;
    }



    /**
     * Pre-warm the customer cache by batch-loading all customers matching the phones/emails
     * we're about to look up. Avoids N sequential round-trips.
     */
    async function prewarmCustomerCache(phones: Set<string>, emails: Set<string>) {
      const phoneArr = Array.from(phones);
      const emailArr = Array.from(emails);
      const tasks: Promise<any>[] = [];
      if (phoneArr.length > 0) {
        for (let i = 0; i < phoneArr.length; i += 500) {
          const chunk = phoneArr.slice(i, i + 500);
          tasks.push(
            supabase.from("customers").select("id, phone").in("phone", chunk).then(({ data }) => {
              (data || []).forEach((r: any) => { if (r.phone) customerCache.set(`p:${r.phone}`, r.id); });
            })
          );
        }
      }
      if (emailArr.length > 0) {
        for (let i = 0; i < emailArr.length; i += 500) {
          const chunk = emailArr.slice(i, i + 500);
          tasks.push(
            supabase.from("customers").select("id, email").in("email", chunk).then(({ data }) => {
              (data || []).forEach((r: any) => { if (r.email) customerCache.set(`e:${r.email}`, r.id); });
            })
          );
        }
      }
      await Promise.all(tasks);
    }

    /** Find-or-create customer GLOBALLY by phone (then email). Uses cache. */
    async function findOrCreateCustomer(args: {
      phone: string | null; email: string | null; name: string | null;
      address: string | null; city: string | null; wooCustomerId?: number | null;
    }): Promise<string | null> {
      const { phone: rawPhone, email, name, address, city, wooCustomerId } = args;
      const phone = normalizePhone(rawPhone);
      if (!phone && !email && !name) return null;

      let customerId: string | null = null;
      if (phone) customerId = customerCache.get(`p:${phone}`) || null;
      if (!customerId && email) customerId = customerCache.get(`e:${email}`) || null;

      if (!customerId && phone) {
        const { data } = await supabase.from("customers").select("id").eq("phone", phone).maybeSingle();
        if (data) { customerId = data.id; customerCache.set(`p:${phone}`, data.id); }
      }
      if (!customerId && email) {
        const { data } = await supabase.from("customers").select("id").eq("email", email).maybeSingle();
        if (data) { customerId = data.id; customerCache.set(`e:${email}`, data.id); }
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
        if (phone) customerCache.set(`p:${phone}`, customerId);
        if (email) customerCache.set(`e:${email}`, customerId);
      }
      queueAliases(customerId, name, email, address, city);
      return customerId;
    }

    // Kick off background sync (runFullSync is hoisted, declared below).
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

    // --- Main sync -------------------------------------------------------
    async function runFullSync() {
    const lastSync = store.last_synced_at ? new Date(store.last_synced_at) : null;
    const sinceIso = lastSync ? new Date(lastSync.getTime() - 5 * 60 * 1000).toISOString() : null;
    const incremental = !!sinceIso;
    ts(`mode: ${incremental ? `incremental since ${sinceIso}` : "full"}`);

    // --- Categories, Products, Orders fetched IN PARALLEL ---
    // Each fetch is independent of the others until upserts happen.
    const productParams = incremental ? { modified_after: sinceIso! } : {};
    const orderParams = incremental ? { modified_after: sinceIso! } : {};

    const [wooCategories, wooProducts, wooOrders] = await Promise.all([
      wooFetchAll("products/categories"),
      wooFetchAll("products", productParams),
      wooFetchAll("orders", orderParams),
    ]);
    ts(`fetched ${wooCategories.length} categories, ${wooProducts.length} products${incremental ? " (modified)" : ""}, ${wooOrders.length} orders${incremental ? " (modified)" : ""}`);

    // --- Categories: upsert in 2 passes (without parent, then with parent_id resolved) ---
    let catByWooId = new Map<number, string>();
    if (wooCategories.length > 0) {
      // Pass 1: insert/update name+slug only
      const catRows1 = wooCategories.map((c: any) => ({
        store_id, woo_category_id: c.id, name: c.name, slug: c.slug || "",
      }));
      const { data: upserted, error: catErr } = await supabase
        .from("categories")
        .upsert(catRows1, { onConflict: "woo_category_id,store_id", ignoreDuplicates: false })
        .select("id, woo_category_id");
      if (catErr) console.error("Categories upsert error:", catErr);
      catByWooId = new Map((upserted || []).map((c: any) => [c.woo_category_id, c.id]));

      // Pass 2: bulk upsert with parent_id resolved (single round-trip instead of N)
      const catRows2 = wooCategories
        .filter((c: any) => c.parent && c.parent > 0 && catByWooId.has(c.parent))
        .map((c: any) => ({
          store_id,
          woo_category_id: c.id,
          name: c.name,
          slug: c.slug || "",
          parent_id: catByWooId.get(c.parent),
        }));
      if (catRows2.length > 0) {
        const { error: pErr } = await supabase
          .from("categories")
          .upsert(catRows2, { onConflict: "woo_category_id,store_id", ignoreDuplicates: false });
        if (pErr) console.error("Categories parent upsert error:", pErr);
      }
      summary.categories = wooCategories.length;
    } else {
      // Still need the map for product->category linking
      const { data: dbCats } = await supabase
        .from("categories").select("id, woo_category_id").eq("store_id", store_id);
      catByWooId = new Map((dbCats || []).map((c: any) => [c.woo_category_id, c.id]));
    }

    // --- Products ---
    const parentProducts = wooProducts.filter((p: any) => p.type !== "variation");
    let prodByWooId = new Map<number, string>();

    if (parentProducts.length > 0) {
      const rows = parentProducts.map((p: any) => {
        // Collect all gallery image URLs (deduped, non-empty)
        const allImages: string[] = Array.from(
          new Set(
            (p.images || [])
              .map((img: any) => img?.src)
              .filter((s: any): s is string => typeof s === "string" && s.length > 0)
          )
        );
        // Prefer Woo's "featured" image when flagged; fall back to first gallery image
        const featured = (p.images || []).find((img: any) => img?.position === 0 || img?.featured) || p.images?.[0];
        const primary = featured?.src || allImages[0] || null;
        return {
          store_id, woo_product_id: p.id, name: p.name, sku: p.sku || null,
          description: p.short_description || p.description || null,
          price: parseFloat(p.price) || 0,
          cost_price: parseFloat(p.meta_data?.find((m: any) => m.key === "_cost")?.value) || 0,
          stock_quantity: p.stock_quantity ?? 0, manage_stock: p.manage_stock ?? false,
          stock_status: fromWooStockStatus(p.stock_status || "instock"),
          backorders: p.backorders || "no",
          category: p.categories?.map((c: any) => c.name).join(", ") || null,
          image_url: primary,
          image_urls: allImages,
          is_active: p.status === "publish",
          barcode: p.meta_data?.find((m: any) => m.key === "_barcode")?.value || null,
        };
      });

      // Single round-trip: upsert + return ids
      const { data: upserted, error } = await supabase
        .from("products")
        .upsert(rows, { onConflict: "woo_product_id,store_id", ignoreDuplicates: false })
        .select("id, woo_product_id");
      if (error) console.error("Products upsert error:", error);
      else summary.products = rows.length;
      prodByWooId = new Map((upserted || []).map((p: any) => [p.woo_product_id, p.id]));

      // product_categories: delete + bulk insert
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
        for (let i = 0; i < productIdsWithCats.length; i += 500) {
          await supabase.from("product_categories").delete().in("product_id", productIdsWithCats.slice(i, i + 500));
        }
      }
      if (pcRows.length > 0) {
        // Parallel chunk inserts
        const chunks: any[][] = [];
        for (let i = 0; i < pcRows.length; i += 500) chunks.push(pcRows.slice(i, i + 500));
        await pMap(chunks, 4, (c) => supabase.from("product_categories").insert(c).then());
      }

      // Variations — parallel by product, parallel pages within each
      const variableProducts = parentProducts.filter((wp: any) => wp.type === "variable");
      ts(`syncing variations for ${variableProducts.length} variable products`);
      await pMap(variableProducts, 5, async (wp: any) => {
        const prodId = prodByWooId.get(wp.id);
        if (!prodId) return;
        try {
          const wooVars = await fetchVariationsAll(wp.id);
          if (wooVars.length === 0) return;
          const varRows = wooVars.map((v: any) => ({
            product_id: prodId, woo_variation_id: v.id,
            name: v.attributes?.map((a: any) => a.option).join(" / ") || `Variation ${v.id}`,
            sku: v.sku || null, price: parseFloat(v.price) || 0,
            // WooCommerce variations may return manage_stock as the string "parent"
            // (= inherit from parent). Coerce to a boolean for our DB column.
            manage_stock: v.manage_stock === true,
            stock_quantity: v.stock_quantity ?? 0,
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
      });
    }

    // --- Customers (one-time / forced) ---
    const shouldSyncCustomers = forceCustomers || !store.customers_synced_at;

    if (shouldSyncCustomers) {
      const wooCustomers = await wooFetchAll("customers");

      // Pre-warm cache from all phones/emails we're about to process
      const phoneSet = new Set<string>();
      const emailSet = new Set<string>();
      for (const c of wooCustomers) {
        const ph = normalizePhone(c.billing?.phone);
        if (ph) phoneSet.add(ph);
        const em = c.email?.trim();
        if (em) emailSet.add(em);
      }
      await prewarmCustomerCache(phoneSet, emailSet);

      let okCount = 0;
      // Bounded concurrency: customer creation can race on duplicate phone, but our
      // cache + ON CONFLICT recovery handles it. Keep moderate to avoid contention.
      await pMap(wooCustomers, 4, async (c: any) => {
        const phone = c.billing?.phone?.trim() || null;
        const email = c.email?.trim() || null;
        const name = `${c.first_name || ""} ${c.last_name || ""}`.trim() || c.username || "Guest";
        const address = [c.billing?.address_1, c.billing?.address_2].filter(Boolean).join(", ") || null;
        const city = c.billing?.city || null;
        const id = await findOrCreateCustomer({ phone, email, name, address, city, wooCustomerId: c.id });
        if (id) okCount++;
      });
      summary.customers = okCount;
      await supabase.from("stores").update({ customers_synced_at: new Date().toISOString() }).eq("id", store_id);
    } else {
      console.log(`Skipping customer sync — already done for store ${store_id}. Use "Sync Customers" to force.`);
    }

    // --- Orders ---
    if (wooOrders.length > 0) {
      // Pre-warm customer cache for ALL order billings in one round-trip set
      const phoneSet = new Set<string>();
      const emailSet = new Set<string>();
      for (const o of wooOrders) {
        const ph = normalizePhone(o.billing?.phone);
        if (ph) phoneSet.add(ph);
        const em = o.billing?.email?.trim();
        if (em) emailSet.add(em);
      }
      await prewarmCustomerCache(phoneSet, emailSet);
      ts(`pre-warmed customer cache (${phoneSet.size} phones, ${emailSet.size} emails)`);

      // Resolve customers in parallel
      const orderCustomerMap = new Map<number, string | null>();
      await pMap(wooOrders, 6, async (o: any) => {
        const phone = o.billing?.phone?.trim() || null;
        const email = o.billing?.email?.trim() || null;
        const billingName = `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim() || null;
        const address = [o.billing?.address_1, o.billing?.address_2].filter(Boolean).join(", ") || null;
        const city = o.billing?.city || null;
        const id = await findOrCreateCustomer({ phone, email, name: billingName, address, city });
        orderCustomerMap.set(o.id, id);
      });
      ts(`resolved customers for ${wooOrders.length} orders`);

      // Reuse the prodByWooId map we already built. Only re-fetch if it's empty
      // (e.g. incremental sync with no changed products but new orders referencing existing ones).
      let prodMap = prodByWooId;
      if (prodMap.size === 0) {
        const { data: dbProducts } = await supabase
          .from("products").select("id, woo_product_id").eq("store_id", store_id);
        prodMap = new Map((dbProducts || []).map((p: any) => [p.woo_product_id, p.id]));
      }

      // Pre-fetch store-level + global woo prefix/suffix and apply locally for speed.
      const { data: storeRow } = await supabase
        .from("stores").select("woo_order_prefix, woo_order_suffix").eq("id", store_id).maybeSingle();
      const { data: invSet } = await supabase
        .from("invoice_settings").select("woo_order_prefix, woo_order_suffix").limit(1).maybeSingle();
      const wPrefix = (storeRow?.woo_order_prefix || invSet?.woo_order_prefix || "");
      const wSuffix = (storeRow?.woo_order_suffix || invSet?.woo_order_suffix || "");

      const orderRows = wooOrders.map((o: any) => {
        const phone = normalizePhone(o.billing?.phone);
        const billingName = `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim();
        const billingAddr = [o.billing?.address_1, o.billing?.address_2].filter(Boolean).join(", ") || null;
        const baseNum = String(o.number || o.id);
        const method = (o.payment_method || "").toLowerCase();
        const title = (o.payment_method_title || "").toLowerCase();
        const orderIsCod = method === "cod" || title.includes("cash on delivery");
        const orderTotal = parseFloat(o.total) || 0;
        return {
          store_id,
          woo_order_id: o.id,
          order_number: `${wPrefix}${baseNum}${wSuffix}`,
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

      // Identify new orders for timeline events
      const wooIds = wooOrders.map((o: any) => o.id);
      const { data: preExisting } = await supabase
        .from("orders")
        .select("woo_order_id, id, status")
        .eq("store_id", store_id)
        .in("woo_order_id", wooIds);
      const preExistingIds = new Set((preExisting || []).map((r: any) => r.woo_order_id));
      const prevStatusMap = new Map<number, string>(
        (preExisting || []).map((r: any) => [r.woo_order_id, r.status])
      );
      const preExistingIdMap = new Map<number, string>(
        (preExisting || []).map((r: any) => [r.woo_order_id, r.id])
      );
      const newWooOrders = wooOrders.filter((o: any) => !preExistingIds.has(o.id));
      const cancelledTransitions = wooOrders.filter((o: any) => {
        if (!preExistingIds.has(o.id)) return false;
        const prev = prevStatusMap.get(o.id);
        const next = mapWooStatus(o.status, o.payment_method || o.payment_method_title || "");
        return prev !== "cancelled" && next === "cancelled";
      });

      // Protect locally-advanced orders: if the order has already moved past
      // payment_pending (e.g. payment confirmed → processing / pre_order_pending),
      // do NOT let the sync overwrite status, payment_status, or amount_to_collect.
      // We still allow cancellation / refund from Woo (those are always authoritative).
      const LOCALLY_ADVANCED = new Set([
        "processing", "pre_order_pending", "pre_order_making", "pre_order_ready",
        "ready_to_ship", "shipped", "delivered", "completed",
      ]);

      const protectedRows: Array<{ dbId: string; row: any }> = [];
      const safeRows: any[] = [];

      for (const row of orderRows) {
        const prev = prevStatusMap.get(row.woo_order_id);
        const incomingIsTerminal = row.status === "cancelled" || row.status === "returned";
        if (prev && LOCALLY_ADVANCED.has(prev) && !incomingIsTerminal) {
          // This order was locally advanced — update it WITHOUT overwriting status fields
          protectedRows.push({ dbId: preExistingIdMap.get(row.woo_order_id)!, row });
        } else {
          safeRows.push(row);
        }
      }

      // Upsert safe orders (new + non-advanced existing) via fast bulk path
      const orderMap = new Map<number, string>();
      for (let i = 0; i < safeRows.length; i += 500) {
        const chunk = safeRows.slice(i, i + 500);
        const { data: upserted, error } = await supabase
          .from("orders")
          .upsert(chunk, { onConflict: "woo_order_id,store_id", ignoreDuplicates: false })
          .select("id, woo_order_id");
        if (error) console.error("Orders upsert error:", error);
        (upserted || []).forEach((r: any) => orderMap.set(r.woo_order_id, r.id));
      }

      // Update protected orders individually, excluding status/payment_status/amount_to_collect
      for (const { dbId, row } of protectedRows) {
        const { status: _s, payment_status: _ps, amount_to_collect: _atc, ...rest } = row;
        const { error } = await supabase.from("orders").update(rest).eq("id", dbId);
        if (error) console.error("Protected order update error:", error);
        orderMap.set(row.woo_order_id, dbId);
      }
      summary.orders = orderRows.length;

      // Insert "created" timeline events for newly imported orders (parallel chunks)
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
                source: "woo_sync", woo_order_id: o.id, woo_status: o.status,
                total: parseFloat(o.total) || 0, user_name: "WooCommerce", user_email: null,
              },
            };
          })
          .filter(Boolean) as any[];
        if (newTimelineRows.length > 0) {
          const tlChunks: any[][] = [];
          for (let i = 0; i < newTimelineRows.length; i += 500) tlChunks.push(newTimelineRows.slice(i, i + 500));
          await pMap(tlChunks, 3, (c) => supabase.from("order_timeline").insert(c).then(({ error }) => {
            if (error) console.warn("Timeline insert warn:", error.message);
          }));
        }
      }

      // Insert "cancelled" timeline + audit entries for orders newly transitioned to cancelled
      if (cancelledTransitions.length > 0) {
        const tlRows: any[] = [];
        const auditRows: any[] = [];
        for (const o of cancelledTransitions) {
          const orderId = orderMap.get(o.id);
          if (!orderId) continue;
          const prev = prevStatusMap.get(o.id) || null;
          tlRows.push({
            order_id: orderId,
            event: "cancelled",
            description: `Order cancelled in WooCommerce (status: ${o.status})`,
            metadata: {
              source: "woo_sync", woo_order_id: o.id, woo_status: o.status,
              previous_status: prev, user_name: "WooCommerce", user_email: null,
            },
          });
          auditRows.push({
            action: "order_cancelled",
            entity_type: "order",
            entity_id: orderId,
            user_email: "woocommerce@system",
            details: { source: "woo_sync", woo_order_id: o.id, woo_status: o.status, previous_status: prev },
          });
        }
        if (tlRows.length > 0) {
          await supabase.from("order_timeline").insert(tlRows).then(({ error }: any) => {
            if (error) console.warn("Cancel timeline insert warn:", error.message);
          });
          await supabase.from("audit_log").insert(auditRows).then(({ error }: any) => {
            if (error) console.warn("Cancel audit insert warn:", error.message);
          });
        }
      }

      // Measurement field map
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

      // Bulk delete old items + measurements (parallel chunks)
      const touchedOrderIds = wooOrders
        .map((o: any) => orderMap.get(o.id))
        .filter((id: any): id is string => !!id);

      if (touchedOrderIds.length > 0) {
        const idChunks: string[][] = [];
        for (let i = 0; i < touchedOrderIds.length; i += 500) idChunks.push(touchedOrderIds.slice(i, i + 500));
        await pMap(idChunks, 3, async (chunk) => {
          await Promise.all([
            supabase.from("order_items").delete().in("order_id", chunk),
            supabase.from("order_item_measurements").delete().in("order_id", chunk).eq("source", "woo"),
          ]);
        });
      }
      ts(`cleared old items/measurements for ${touchedOrderIds.length} orders`);

      // Build line item rows
      type StagedItem = { row: any; wooOrderId: number; lineIdx: number };
      const staged: StagedItem[] = [];
      for (const o of wooOrders) {
        const orderId = orderMap.get(o.id);
        if (!orderId) continue;
        (o.line_items || []).forEach((li: any, idx: number) => {
          const variationLabel = buildVariationLabel(li.meta_data || [], fieldMap);
          const fullName = variationLabel ? `${li.name} - ${variationLabel}` : li.name;
          staged.push({
            row: {
              order_id: orderId,
              product_id: prodMap.get(li.product_id) || null,
              product_name: fullName,
              quantity: li.quantity,
              unit_price: parseFloat(li.price) || 0,
              line_total: parseFloat(li.total) || 0,
            },
            wooOrderId: o.id,
            lineIdx: idx,
          });
        });
      }

      // Bulk insert items in PARALLEL chunks while preserving id mapping back to source line items.
      const insertedItemIds: (string | null)[] = new Array(staged.length).fill(null);
      const itemChunks: { offset: number; rows: any[] }[] = [];
      for (let i = 0; i < staged.length; i += 500) {
        itemChunks.push({ offset: i, rows: staged.slice(i, i + 500).map((s) => s.row) });
      }
      await pMap(itemChunks, 3, async (chunk) => {
        const { data: ins, error: itemErr } = await supabase
          .from("order_items")
          .insert(chunk.rows)
          .select("id");
        if (itemErr) console.error(`Order items bulk insert error:`, itemErr);
        (ins || []).forEach((r: any, j: number) => { insertedItemIds[chunk.offset + j] = r.id; });
      });
      summary.order_items = staged.length;
      ts(`inserted ${staged.length} order items`);

      // Build measurement rows
      const measRows: any[] = [];
      const lineByKey = new Map<string, number>();
      staged.forEach((s, idx) => lineByKey.set(`${s.wooOrderId}|${s.lineIdx}`, idx));

      for (const o of wooOrders) {
        const orderId = orderMap.get(o.id);
        if (!orderId) continue;
        (o.line_items || []).forEach((li: any, idx: number) => {
          const stagedIdx = lineByKey.get(`${o.id}|${idx}`);
          const dbItemId = stagedIdx != null ? insertedItemIds[stagedIdx] : null;
          extractMeasurementsFromMeta(li.meta_data || [], fieldMap).forEach((g) => {
            measRows.push({
              order_id: orderId, order_item_id: dbItemId,
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
      }

      if (measRows.length > 0) {
        const mChunks: any[][] = [];
        for (let i = 0; i < measRows.length; i += 500) mChunks.push(measRows.slice(i, i + 500));
        await pMap(mChunks, 3, (c) => supabase.from("order_item_measurements").insert(c).then(({ error }) => {
          if (error) console.warn(`Measurements bulk insert warn:`, error.message);
        }));
        ts(`inserted ${measRows.length} measurements`);
      }
    }

    // Flush any aliases queued during customer/order processing
    await flushAliases();
    } // end runFullSync
  } catch (err: any) {
    console.error("woo-sync error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});


