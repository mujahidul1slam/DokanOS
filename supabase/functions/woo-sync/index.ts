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

    const summary = { products: 0, orders: 0, order_items: 0, customers: 0 };

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
        category: p.categories?.[0]?.name || null,
        image_url: p.images?.[0]?.src || null,
        is_active: p.status === "publish",
        barcode: p.meta_data?.find((m: any) => m.key === "_barcode")?.value || null,
      }));

      const { error } = await supabase
        .from("products")
        .upsert(rows, { onConflict: "woo_product_id,store_id", ignoreDuplicates: false });
      if (error) console.error("Products upsert error:", error);
      else summary.products = rows.length;
    }

    // --- Sync Customers (registered) ---
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
      // Build customer lookup
      const { data: dbCustomers } = await supabase
        .from("customers")
        .select("id, woo_customer_id")
        .eq("store_id", store_id);
      const custMap = new Map(
        (dbCustomers || []).map((c: any) => [c.woo_customer_id, c.id])
      );

      // For guest orders (customer_id=0), create customers from billing info
      for (const o of wooOrders) {
        if ((!o.customer_id || o.customer_id === 0) && o.billing?.phone) {
          const guestName = `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim() || "Guest";
          const { data: guestCust } = await supabase
            .from("customers")
            .upsert({
              store_id,
              woo_customer_id: null,
              name: guestName,
              email: o.billing?.email || null,
              phone: o.billing?.phone || null,
              address: [o.billing?.address_1, o.billing?.address_2].filter(Boolean).join(", ") || null,
              city: o.billing?.city || null,
            }, { onConflict: "id" })
            .select("id")
            .single();
          if (guestCust) {
            // Store temp mapping using negative woo order id
            custMap.set(-o.id, guestCust.id);
          }
        }
      }

      // Build product lookup
      const { data: dbProducts } = await supabase
        .from("products")
        .select("id, woo_product_id")
        .eq("store_id", store_id);
      const prodMap = new Map(
        (dbProducts || []).map((p: any) => [p.woo_product_id, p.id])
      );

      const orderRows = wooOrders.map((o: any) => {
        const customerId = o.customer_id && o.customer_id > 0
          ? custMap.get(o.customer_id) || null
          : custMap.get(-o.id) || null;

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

      // Order items
      const { data: dbOrders } = await supabase
        .from("orders")
        .select("id, woo_order_id")
        .eq("store_id", store_id);
      const orderMap = new Map(
        (dbOrders || []).map((o: any) => [o.woo_order_id, o.id])
      );

      const allItems: any[] = [];
      for (const o of wooOrders) {
        const orderId = orderMap.get(o.id);
        if (!orderId) continue;
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

      if (allItems.length > 0) {
        const orderIds = [...new Set(allItems.map((i) => i.order_id))];
        for (const oid of orderIds) {
          await supabase.from("order_items").delete().eq("order_id", oid);
        }
        const { error: itemErr } = await supabase.from("order_items").insert(allItems);
        if (itemErr) console.error("Order items insert error:", itemErr);
        else summary.order_items = allItems.length;
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
