import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface CheckoutItem { product_id: string; quantity: number; }
interface CheckoutBody {
  storefront_slug: string;
  customer: {
    name: string; phone: string; email?: string; address: string;
    city_id: number; zone_id: number; area_id?: number | null;
    city_name?: string; zone_name?: string; area_name?: string;
  };
  items: CheckoutItem[];
  payment: { method: "cod" | "bkash" | "nagad"; trx_id?: string | null; sender?: string | null };
  special_instruction?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status });

  try {
    const body = (await req.json()) as CheckoutBody;
    if (!body?.storefront_slug || !body?.customer || !Array.isArray(body?.items) || body.items.length === 0) {
      return json({ error: "Invalid payload" }, 400);
    }
    const c = body.customer;
    if (!c.name || !c.phone || !c.address || !c.city_id || !c.zone_id) {
      return json({ error: "Missing customer fields" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Load storefront
    const { data: sf, error: sfErr } = await supabase
      .from("storefronts").select("*").eq("slug", body.storefront_slug).maybeSingle();
    if (sfErr || !sf) return json({ error: "Storefront not found" }, 404);
    if (!sf.is_active) return json({ error: "Storefront not active" }, 403);

    // Verify all product_ids are on this storefront
    const ids = body.items.map((i) => i.product_id);
    const { data: sfProducts } = await supabase
      .from("storefront_products").select("product_id").eq("storefront_id", sf.id).in("product_id", ids);
    const allowedSet = new Set((sfProducts || []).map((r: any) => r.product_id));
    for (const id of ids) {
      if (!allowedSet.has(id)) return json({ error: `Product ${id} not available on this storefront` }, 400);
    }

    // Fetch products with current prices & stock
    const { data: products } = await supabase
      .from("products")
      .select("id,name,price,image_url,image_urls,stock_quantity,manage_stock,is_active")
      .in("id", ids);
    if (!products || products.length !== ids.length) return json({ error: "Some products not found" }, 400);

    const prodMap = new Map(products.map((p: any) => [p.id, p]));
    let subtotal = 0;
    const orderItems: any[] = [];
    for (const it of body.items) {
      const p: any = prodMap.get(it.product_id);
      if (!p?.is_active) return json({ error: `${p?.name || "Product"} is not available` }, 400);
      if (p.manage_stock && p.stock_quantity < it.quantity) {
        return json({ error: `${p.name} is out of stock` }, 400);
      }
      const lineTotal = Number(p.price) * it.quantity;
      subtotal += lineTotal;
      orderItems.push({
        product_id: p.id, product_name: p.name,
        quantity: it.quantity, unit_price: Number(p.price), line_total: lineTotal,
      });
    }

    // Shipping
    const { data: inv } = await supabase.from("invoice_settings").select("shipping_inside_dhaka, shipping_outside_dhaka").limit(1).maybeSingle();
    const isDhaka = (c.city_name || "").toLowerCase().includes("dhaka");
    const shipping = isDhaka ? Number(inv?.shipping_inside_dhaka ?? 80) : Number(inv?.shipping_outside_dhaka ?? 150);
    const total = subtotal + shipping;

    // Upsert customer
    let customerId: string | null = null;
    const { data: existing } = await supabase
      .from("customers").select("id").eq("phone", c.phone).maybeSingle();
    if (existing) {
      customerId = existing.id;
      await supabase.from("customers").update({
        name: c.name, email: c.email || null, address: c.address,
        city: c.city_name || null, zone: c.zone_name || null, area: c.area_name || null,
        store_id: sf.store_id,
      }).eq("id", customerId);
    } else {
      const { data: ins } = await supabase.from("customers").insert({
        name: c.name, phone: c.phone, email: c.email || null, address: c.address,
        city: c.city_name || null, zone: c.zone_name || null, area: c.area_name || null,
        source: "online", store_id: sf.store_id,
      }).select("id").single();
      customerId = ins?.id ?? null;
    }

    // Generate order number
    const { data: numData } = await supabase.rpc("generate_pos_order_number", {
      p_store_id: sf.store_id, p_source: "online",
    });
    const orderNumber = numData as unknown as string;

    const paymentMethod = body.payment.method;
    const paymentStatus = paymentMethod === "cod" ? "unpaid" : "pending_verification";
    const paymentMeta = paymentMethod === "cod"
      ? { method: "cod" }
      : { method: paymentMethod, trx_id: body.payment.trx_id || null, sender: body.payment.sender || null };

    const { data: orderRow, error: orderErr } = await supabase.from("orders").insert({
      order_number: orderNumber,
      source: "online",
      status: "pending",
      payment_status: paymentStatus,
      payment_method: paymentMethod,
      payment_meta: paymentMeta,
      fulfillment_type: "delivery",
      customer_id: customerId,
      customer_name: c.name,
      customer_phone: c.phone,
      customer_email: c.email || null,
      customer_address: c.address,
      customer_city: c.city_name || null,
      store_id: sf.store_id,
      subtotal, shipping_cost: shipping, total,
      amount_to_collect: paymentMethod === "cod" ? total : 0,
      item_qty: orderItems.reduce((s, i) => s + i.quantity, 0),
      pathao_recipient_city: c.city_id,
      pathao_recipient_zone: c.zone_id,
      pathao_recipient_area: c.area_id || null,
      special_instruction: body.special_instruction || null,
      notes: `Placed via ${sf.name} storefront`,
    }).select("id, order_number").single();

    if (orderErr || !orderRow) return json({ error: orderErr?.message || "Order insert failed" }, 500);

    await supabase.from("order_items").insert(
      orderItems.map((i) => ({ ...i, order_id: orderRow.id })),
    );
    await supabase.from("order_timeline").insert({
      order_id: orderRow.id, event: "created",
      description: `Online order placed via ${sf.name} storefront`,
      metadata: { storefront: sf.slug, payment: paymentMethod },
    });

    return json({ order_id: orderRow.id, order_number: orderRow.order_number });
  } catch (e: any) {
    return json({ error: e?.message || "Unexpected error" }, 500);
  }
});
