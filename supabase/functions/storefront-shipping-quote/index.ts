import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ShippingQuoteBody {
  storefront_slug: string;
  city_id?: number | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status,
    });

  try {
    const body = (await req.json()) as ShippingQuoteBody;
    if (!body?.storefront_slug) {
      return json({ error: "Missing storefront_slug" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Resolve storefront
    const { data: sf, error: sfErr } = await supabase
      .from("storefronts")
      .select("id, slug, is_active, currency, settings")
      .eq("slug", body.storefront_slug)
      .maybeSingle();

    if (sfErr || !sf) {
      return json({ error: "Storefront not found" }, 404);
    }
    if (!sf.is_active) {
      return json({ error: "Storefront not active" }, 403);
    }

    // 2. Fetch shipping rates from invoice_settings (service role)
    const { data: inv } = await supabase
      .from("invoice_settings")
      .select("shipping_inside_dhaka, shipping_outside_dhaka")
      .limit(1)
      .maybeSingle();

    const insideDhakaRate = Number(inv?.shipping_inside_dhaka ?? 80);
    const outsideDhakaRate = Number(inv?.shipping_outside_dhaka ?? 150);

    // 3. Extract shipping settings
    const settings = (sf.settings as any) || {};
    const freeThreshold = Number.isFinite(Number(settings?.shipping?.free_threshold))
      ? Number(settings.shipping.free_threshold)
      : 0;

    // 4. Determine if city is inside Dhaka if city_id provided
    let isInsideDhaka = false;
    if (body.city_id) {
      const { data: city } = await supabase
        .from("pathao_cities")
        .select("city_name")
        .eq("city_id", body.city_id)
        .maybeSingle();

      if (city?.city_name) {
        isInsideDhaka = /dhaka/i.test(city.city_name);
      }
    }

    const rate = isInsideDhaka ? insideDhakaRate : outsideDhakaRate;

    return json({
      inside_dhaka: insideDhakaRate,
      outside_dhaka: outsideDhakaRate,
      rate,
      is_inside_dhaka: isInsideDhaka,
      free_threshold: freeThreshold,
      currency: sf.currency || "BDT",
    });
  } catch (err: any) {
    return json({ error: err?.message || "Internal server error" }, 500);
  }
});
