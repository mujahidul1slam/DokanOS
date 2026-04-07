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

    // WooCommerce sends the initial ping as form-urlencoded (e.g. "webhook_id=11")
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = JSON.parse(body);

    // WooCommerce sends a webhook_id field on the initial ping — just acknowledge
    if (payload.webhook_id && !payload.line_items) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const webhookSource = req.headers.get("x-wc-webhook-source") || "";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Find the store by URL
    const normalizedSource = webhookSource.replace(/\/+$/, "");
    const { data: store } = await supabase
      .from("stores")
      .select("id")
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
    const o = payload;

    // Upsert customer
    let customer_id: string | null = null;
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
    }

    // Product lookup
    const { data: dbProducts } = await supabase
      .from("products")
      .select("id, woo_product_id")
      .eq("store_id", store_id);
    const prodMap = new Map((dbProducts || []).map((p: any) => [p.woo_product_id, p.id]));

    // Upsert order
    const orderRow = {
      store_id,
      woo_order_id: o.id,
      order_number: String(o.number || o.id),
      source: "online",
      status: mapWooStatus(o.status),
      payment_method: o.payment_method_title || o.payment_method || null,
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
  } catch (err: any) {
    console.error("woo-webhook error:", err);
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
