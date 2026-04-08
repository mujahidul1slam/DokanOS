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
    const { store_id } = await req.json();
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

    async function wooFetchAll(endpoint: string) {
      const all: any[] = [];
      let page = 1;
      while (true) {
        const url = `${baseUrl}/wp-json/wc/v3/${endpoint}?per_page=100&page=${page}`;
        const res = await fetch(url, { headers: { Authorization: authHeader } });
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
      const res = await fetch(url, { headers: { Authorization: authHeader } });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`WooCommerce API error (${endpoint}): ${res.status} ${text}`);
      }
      return res.json();
    }

    const summary = { products: 0, orders: 0, order_items: 0, customers: 0, categories: 0, variations: 0 };

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
    if (wooProducts.length > 0) {
      const rows = wooProducts.map((p: any) => ({
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
      for (const wp of wooProducts) {
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

      // --- Sync Variations for variable products ---
      for (const wp of wooProducts) {
        if (wp.type !== "variable" || !wp.variations?.length) continue;
        const prodId = prodByWooId.get(wp.id);
        if (!prodId) continue;

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
          stock_status: v.stock_status || "in_stock",
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
      }
    }

    // --- Sync Customers ---
    const wooCustomers = await wooFetchAll("customers");
    if (wooCustomers.length > 0) {
      const rows = wooCustomers.map((c: any) => ({
        store_id,
        woo_customer_id: c.id,
        name: `${c.first_name || ""} ${c.last_name || ""}`.trim() || c.username || "Guest",
        email: c.email || null,
        phone: c.billing?.phone || null,
        address: [c.billing?.address_1, c.billing?.address_2].filter(Boolean).join(", ") || null,
        city: c.billing?.city || null,
      }));

      const { error } = await supabase
        .from("customers")
        .upsert(rows, { onConflict: "woo_customer_id,store_id", ignoreDuplicates: false });
      if (error) console.error("Customers upsert error:", error);
      else summary.customers = rows.length;
    }

    // --- Sync Orders ---
    const wooOrders = await wooFetchAll("orders");
    if (wooOrders.length > 0) {
      const { data: dbCustomers } = await supabase
        .from("customers")
        .select("id, woo_customer_id, phone")
        .eq("store_id", store_id);
      const custByWooId = new Map(
        (dbCustomers || []).filter((c: any) => c.woo_customer_id).map((c: any) => [c.woo_customer_id, c.id])
      );
      const custByPhone = new Map(
        (dbCustomers || []).filter((c: any) => c.phone).map((c: any) => [c.phone, c.id])
      );

      for (const o of wooOrders) {
        if ((!o.customer_id || o.customer_id === 0) && (o.billing?.phone || o.billing?.email)) {
          const phone = o.billing?.phone || null;
          if (phone && custByPhone.has(phone)) {
            custByWooId.set(-o.id, custByPhone.get(phone));
            continue;
          }
          const guestName = `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim() || "Guest";
          const { data: guestCust } = await supabase
            .from("customers")
            .insert({
              store_id,
              name: guestName,
              email: o.billing?.email || null,
              phone,
              address: [o.billing?.address_1, o.billing?.address_2].filter(Boolean).join(", ") || null,
              city: o.billing?.city || null,
            })
            .select("id")
            .single();
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
        const customerId = o.customer_id && o.customer_id > 0
          ? custByWooId.get(o.customer_id) || null
          : custByWooId.get(-o.id) || null;

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
          notes: o.customer_note || null,
          created_at: o.date_created_gmt ? o.date_created_gmt + "Z" : undefined,
        };
      });

      const { error } = await supabase
        .from("orders")
        .upsert(orderRows, { onConflict: "woo_order_id,store_id", ignoreDuplicates: false });
      if (error) console.error("Orders upsert error:", error);
      else summary.orders = orderRows.length;

      const { data: dbOrders } = await supabase
        .from("orders")
        .select("id, woo_order_id")
        .eq("store_id", store_id);
      const orderMap = new Map(
        (dbOrders || []).map((o: any) => [o.woo_order_id, o.id])
      );

      const orderIdsToRefresh: string[] = [];
      const allItems: any[] = [];
      for (const o of wooOrders) {
        const orderId = orderMap.get(o.id);
        if (!orderId) continue;
        orderIdsToRefresh.push(orderId);
        for (const li of o.line_items || []) {
          allItems.push({
            order_id: orderId,
            product_id: prodMap.get(li.product_id) || null,
            product_name: li.name,
            quantity: li.quantity,
            unit_price: parseFloat(li.price) || 0,
            line_total: parseFloat(li.total) || 0,
          });
        }
      }

      if (orderIdsToRefresh.length > 0) {
        await supabase.from("order_items").delete().in("order_id", orderIdsToRefresh);
      }

      if (allItems.length > 0) {
        for (let i = 0; i < allItems.length; i += 500) {
          const chunk = allItems.slice(i, i + 500);
          const { error: itemErr } = await supabase.from("order_items").insert(chunk);
          if (itemErr) console.error("Order items insert error:", itemErr);
        }
        summary.order_items = allItems.length;
      }
    }

    await supabase
      .from("stores")
      .update({ status: "connected", last_synced_at: new Date().toISOString() })
      .eq("id", store_id);

    return new Response(JSON.stringify({ success: true, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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
