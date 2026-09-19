import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface CheckoutItem {
  product_id: string;
  variation_id?: string | null;
  variation_label?: string | null;
  quantity: number;
}

interface CheckoutBody {
  idempotency_key?: string;
  storefront_slug: string;
  customer: {
    name: string;
    phone: string;
    email?: string;
    address: string;
    city_id: number;
    zone_id: number;
    area_id?: number | null;
    city_name?: string;
    zone_name?: string;
    area_name?: string;
  };
  items: CheckoutItem[];
  payment: {
    method: "cod" | "bkash" | "nagad" | "rocket" | "upay" | "mcash";
    trx_id?: string | null;
    sender?: string | null;
    /** Parity advance-payment: collected amount online, rest due on delivery */
    advance_amount?: number | null;
    advance_due_on_delivery?: number | null;
  };
  special_instruction?: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status,
    });

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
      .from("storefronts")
      .select("*")
      .eq("slug", body.storefront_slug)
      .maybeSingle();

    if (sfErr || !sf) return json({ error: "Storefront not found" }, 404);
    if (!sf.is_active) return json({ error: "Storefront not active" }, 403);

    const sfSettings = (sf.settings || {}) as any;

// Phase 5: Payment method enforcement
// Prefer the explicit array if a caller saved one; otherwise derive from the
// boolean map the storefront admin writes (checkout.methods.<key> = true/false).
const methodsMap = (sfSettings as any)?.checkout?.methods || {};
const enabledMethods: string[] = Array.isArray(sfSettings?.checkout?.enabled_payment_methods)
? sfSettings.checkout.enabled_payment_methods
: Object.entries(methodsMap).filter(([, v]) => !!v).map(([k]) => k);
    if (enabledMethods.length > 0 && !enabledMethods.includes(body.payment?.method)) {
      return json({ error: `Payment method ${body.payment?.method || ""} is not accepted` }, 400);
    }

    // Verify all product_ids belong to this storefront
    const prodIds = Array.from(new Set(body.items.map((i) => i.product_id)));
    const { data: sfProducts } = await supabase
      .from("storefront_products")
      .select("product_id")
      .eq("storefront_id", sf.id)
      .in("product_id", prodIds);

    const allowedSet = new Set((sfProducts || []).map((r: any) => r.product_id));
    for (const id of prodIds) {
      if (!allowedSet.has(id)) {
        return json({ error: `Product ${id} not available on this storefront` }, 400);
      }
    }

    // Fetch products
    const { data: products } = await supabase
      .from("products")
      .select("id, name, price, stock_quantity, manage_stock, is_active")
      .in("id", prodIds);

    if (!products || products.length !== prodIds.length) {
      return json({ error: "Some products not found" }, 400);
    }
    const prodMap = new Map(products.map((p: any) => [p.id, p]));

    // Fetch variations if any
    const varIds = body.items.map((i) => i.variation_id).filter(Boolean) as string[];
    let varMap = new Map<string, any>();
    if (varIds.length > 0) {
      const { data: variations } = await supabase
        .from("product_variations")
        .select("id, product_id, attributes, price, stock_quantity, manage_stock, is_active")
        .in("id", varIds);

      if (variations) {
        varMap = new Map(variations.map((v: any) => [v.id, v]));
      }
    }

    // Validate items, prices, and stock
    let subtotal = 0;
    const orderItems: any[] = [];

    for (const it of body.items) {
      const p: any = prodMap.get(it.product_id);
      if (!p?.is_active) {
        return json({ error: `${p?.name || "Product"} is not available` }, 400);
      }

      let unitPrice = Number(p.price);
      let productName = p.name;

      if (it.variation_id) {
        const v: any = varMap.get(it.variation_id);
        if (!v || v.product_id !== p.id || !v.is_active) {
          return json({ error: `Selected variation for ${p.name} is not available` }, 400);
        }
        // Fact 13 / M2: gate availability strictly on manage_stock && stock_quantity < it.quantity
        if (v.manage_stock && v.stock_quantity < it.quantity) {
          return json({ error: `${p.name} is out of stock` }, 400);
        }
        if (v.price && Number(v.price) > 0) {
          unitPrice = Number(v.price);
        }
        if (it.variation_label) {
          productName = `${p.name} (${it.variation_label})`;
        }
      } else {
        // Parent-level item
        if (p.manage_stock && p.stock_quantity < it.quantity) {
          return json({ error: `${p.name} is out of stock` }, 400);
        }
      }

      const lineTotal = unitPrice * it.quantity;
      subtotal += lineTotal;

      orderItems.push({
        product_id: p.id,
        variation_id: it.variation_id || null,
        product_name: productName,
        quantity: it.quantity,
        unit_price: unitPrice,
        line_total: lineTotal,
      });
    }

    // Phase 5: min_order_amount enforcement
    const minOrderAmount = Number(sfSettings?.checkout?.min_order_amount || 0);
    if (minOrderAmount > 0 && subtotal < minOrderAmount) {
      return json({ error: `Minimum order amount is ৳${minOrderAmount}` }, 400);
    }

    // Shipping calculation from invoice_settings + free shipping threshold
    const { data: inv } = await supabase
      .from("invoice_settings")
      .select("shipping_inside_dhaka, shipping_outside_dhaka")
      .limit(1)
      .maybeSingle();

    const isDhaka = (c.city_name || "").toLowerCase().includes("dhaka");
    const baseShipping = isDhaka
      ? Number(inv?.shipping_inside_dhaka ?? 80)
      : Number(inv?.shipping_outside_dhaka ?? 150);

    const freeThreshold = Number(sfSettings?.shipping?.free_threshold || 0);
    const shipping = freeThreshold > 0 && subtotal >= freeThreshold ? 0 : baseShipping;
    const total = subtotal + shipping;

    // Generate order number
    const { data: numData } = await supabase.rpc("generate_pos_order_number", {
      p_store_id: sf.store_id,
      p_source: "online",
    });
    let orderNumber = numData as unknown as string;

    const paymentMethod = body.payment.method;
    // Advance payment (from client; server re-validates against settings.delivery)
    const advanceEnabled = !!(sfSettings?.delivery?.advance_payment_enabled) && Number(sfSettings?.delivery?.advance_percent) > 0;
    const advancePct = advanceEnabled ? Number(sfSettings.delivery.advance_percent) : 0;
    const serverAdvanceAmount = advanceEnabled ? Math.round((total * advancePct) / 100) : 0;
    const clientAdvance = Number(body.payment?.advance_amount || 0);

    if (advanceEnabled && paymentMethod === "cod") {
      return json({ error: "This store requires an online advance payment." }, 400);
    }
    if (advanceEnabled && paymentMethod !== "cod" && Math.abs(clientAdvance - serverAdvanceAmount) > 1) {
      return json({ error: "Advance payment amount mismatch. Expected " + serverAdvanceAmount + "." }, 400);
    }

    const amountDueOnDelivery = advanceEnabled ? total - serverAdvanceAmount : total;
    const paymentStatus = advanceEnabled ? "partially_paid" : paymentMethod === "cod" ? "unpaid" : "pending_verification";
    const paymentMeta =
      paymentMethod === "cod"
        ? { method: "cod" }
        : {
            method: paymentMethod,
            trx_id: body.payment.trx_id || null,
            sender: body.payment.sender || null,
            advance_amount: advanceEnabled ? serverAdvanceAmount : undefined,
            advance_due_on_delivery: advanceEnabled ? amountDueOnDelivery : undefined,
          };

    // Prepare atomic RPC payload
    const rpcPayload = {
      idempotency_key: body.idempotency_key || crypto.randomUUID(),
      storefront_id: sf.id,
      store_id: sf.store_id,
      customer: {
        name: c.name,
        phone: c.phone,
        email: c.email || null,
        address: c.address,
        city_name: c.city_name || null,
        zone_name: c.zone_name || null,
        area_name: c.area_name || null,
      },
      order: {
        order_number: orderNumber,
        source: "online",
        status: "pending",
        payment_status: paymentStatus,
        payment_method: paymentMethod,
        payment_trx_id: body.payment.trx_id || null,
        payment_sender: body.payment.sender || null,
        payment_meta: paymentMeta,
        fulfillment_type: "delivery",
        subtotal,
        shipping_cost: shipping,
        total,
        amount_to_collect: amountDueOnDelivery,
        item_qty: orderItems.reduce((s, i) => s + i.quantity, 0),
        pathao_recipient_city: c.city_id,
        pathao_recipient_zone: c.zone_id,
        pathao_recipient_area: c.area_id || null,
        special_instruction: body.special_instruction || null,
        notes: `Placed via ${sf.name} storefront`,
      },
      items: orderItems,
    };

    // Single atomic RPC invocation (H2)
    let { data: rpcRes, error: rpcErr } = await supabase.rpc("storefront_place_order", {
      p_payload: rpcPayload,
    });

    // L8: Retry once on uq_orders_order_number collision with fresh order number
    if (rpcErr && (rpcErr.message?.includes("uq_orders_order_number") || rpcErr.details?.includes("uq_orders_order_number"))) {
      const { data: retryNum } = await supabase.rpc("generate_pos_order_number", {
        p_store_id: sf.store_id,
        p_source: "online",
      });
      orderNumber = retryNum as unknown as string;
      rpcPayload.order.order_number = orderNumber;

      const retryRes = await supabase.rpc("storefront_place_order", {
        p_payload: rpcPayload,
      });
      rpcRes = retryRes.data;
      rpcErr = retryRes.error;

      if (rpcErr && (rpcErr.message?.includes("uq_orders_order_number") || rpcErr.details?.includes("uq_orders_order_number"))) {
        return json({ error: "Order number conflict, please retry" }, 409);
      }
    }

    if (rpcErr) {
      if (rpcErr.code === "P0001" || rpcErr.message?.includes("stock") || rpcErr.message?.includes("out of stock")) {
        return json({ error: rpcErr.message }, 400);
      }
      return json({ error: rpcErr.message || "Order placement failed" }, 500);
    }

    return json({
      order_id: (rpcRes as any)?.order_id,
      order_number: (rpcRes as any)?.order_number,
      deduped: !!(rpcRes as any)?.deduped,
    });
  } catch (e: any) {
    return json({ error: e?.message || "Unexpected error" }, 500);
  }
});
