import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PATHAO_BASE = "https://api-hermes.pathao.com";

// In-memory token cache per integration (lives for the function's runtime)
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

// Maps any Pathao tracking status to one of our 5 internal buckets:
// Pickup Pending + In Transit -> "shipped" | Delivered -> "delivered"
// On Hold -> "processing" | Returned -> "returned" | Cancelled -> "cancelled"
function mapPathaoStatus(status: string | null | undefined): string | undefined {
  if (!status) return undefined;
  const s = status.trim().toLowerCase();
  if ([
    "pending","pickup pending","pickup requested","assigned for pickup",
    "picked","picked up","pickup cancel","pickup cancelled","pickup canceled",
  ].includes(s)) return "shipped";
  if ([
    "at sorting hub","in transit","on the way to delivery hub","at delivery hub","out for delivery",
  ].includes(s)) return "shipped";
  if (["delivered","partial delivered","payment invoice"].includes(s)) return "delivered";
  if (["on hold","hold","exchange"].includes(s)) return "processing";
  if (["return","returned","delivery failed","customer refused"].includes(s)) return "returned";
  if (["cancelled","canceled"].includes(s)) return "cancelled";
  return undefined;
}

// Invoke woo-push edge function to sync order status back to WooCommerce.
// Used when a Pathao tracking update transitions an order to "delivered".
async function pushOrderStatusToWoo(sb: any, orderId: string): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const res = await fetch(`${supabaseUrl}/functions/v1/woo-push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ action: "push_order", order_id: orderId }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`woo-push responded ${res.status}: ${text}`);
  }
}

// Post a note on the WooCommerce order (silently no-ops if not Woo-linked)
async function postWooOrderNote(orderId: string, note: string): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    await fetch(`${supabaseUrl}/functions/v1/woo-push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ action: "post_note", order_id: orderId, note }),
    });
  } catch (e) {
    console.warn("postWooOrderNote failed:", e);
  }
}

interface PathaoCreds {
  id: string;
  client_id: string;
  client_secret: string;
  username: string;
  password: string;
}

function supabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

async function loadIntegration(sb: ReturnType<typeof supabaseAdmin>, integrationId?: string): Promise<PathaoCreds> {
  let q = sb.from("pathao_integrations").select("id, client_id, client_secret, username, password").eq("is_active", true);
  if (integrationId) q = q.eq("id", integrationId);
  const { data, error } = await q.limit(1).maybeSingle();
  if (error || !data) {
    // Fallback to env vars (legacy)
    const envCreds = {
      id: "env",
      client_id: Deno.env.get("PATHAO_CLIENT_ID") || "",
      client_secret: Deno.env.get("PATHAO_CLIENT_SECRET") || "",
      username: Deno.env.get("PATHAO_USERNAME") || "",
      password: Deno.env.get("PATHAO_PASSWORD") || "",
    };
    if (!envCreds.client_id) throw new Error("No Pathao integration found");
    return envCreds;
  }
  return data as PathaoCreds;
}

async function getAccessToken(creds: PathaoCreds): Promise<string> {
  const cached = tokenCache.get(creds.id);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const res = await fetch(`${PATHAO_BASE}/aladdin/api/v1/issue-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      username: creds.username,
      password: creds.password,
      grant_type: "password",
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Pathao auth failed [${res.status}]: ${txt}`);
  }
  const data = await res.json();
  tokenCache.set(creds.id, {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  });
  return data.access_token;
}

async function pathaoGet(token: string, path: string) {
  const res = await fetch(`${PATHAO_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Pathao GET ${path} failed [${res.status}]: ${txt}`);
  }
  return res.json();
}

async function pathaoPost(token: string, path: string, body: unknown) {
  const res = await fetch(`${PATHAO_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `Pathao POST ${path} failed [${res.status}]: ${JSON.stringify(data)}`
    );
  }
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const sb = supabaseAdmin();
    const body = await req.json();
    const { action, integration_id, ...params } = body;

    // `track_all` is a system-level refresh action: it does not accept user-specific
    // input and only writes Pathao tracking status onto orders. Allow it without
    // a user JWT so it can be triggered by pg_cron / scheduled jobs.
    const isSystemTrackAll = action === "track_all";

    if (!isSystemTrackAll) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const bearer = authHeader.replace("Bearer ", "");
      const { data: { user: caller }, error: authErr } = await sb.auth.getUser(bearer);
      if (authErr || !caller) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const creds = await loadIntegration(sb, integration_id);
    const token = await getAccessToken(creds);

    let result: unknown;

    switch (action) {
      case "get_cities": {
        const data = await pathaoGet(token, "/aladdin/api/v1/countries/1/city-list");
        const cities = data.data?.data || data.data || [];
        if (cities.length > 0) {
          await sb.from("pathao_cities").upsert(
            cities.map((c: any) => ({
              city_id: c.city_id,
              city_name: c.city_name,
              fetched_at: new Date().toISOString(),
            })),
            { onConflict: "city_id" }
          );
        }
        result = cities;
        break;
      }

      case "get_zones": {
        const { city_id } = params;
        const data = await pathaoGet(token, `/aladdin/api/v1/cities/${city_id}/zone-list`);
        const zones = data.data?.data || data.data || [];
        if (zones.length > 0) {
          await sb.from("pathao_zones").upsert(
            zones.map((z: any) => ({
              zone_id: z.zone_id,
              zone_name: z.zone_name,
              city_id,
              fetched_at: new Date().toISOString(),
            })),
            { onConflict: "zone_id" }
          );
        }
        result = zones;
        break;
      }

      case "get_areas": {
        const { zone_id } = params;
        const data = await pathaoGet(token, `/aladdin/api/v1/zones/${zone_id}/area-list`);
        const areas = data.data?.data || data.data || [];
        if (areas.length > 0) {
          await sb.from("pathao_areas").upsert(
            areas.map((a: any) => ({
              area_id: a.area_id,
              area_name: a.area_name,
              zone_id,
              fetched_at: new Date().toISOString(),
            })),
            { onConflict: "area_id" }
          );
        }
        result = areas;
        break;
      }

      case "get_stores": {
        const data = await pathaoGet(token, "/aladdin/api/v1/stores");
        const allStores = data.data?.data || data.data || [];

        let allowed: number[] = [];
        if (creds.id !== "env") {
          const { data: integ } = await sb
            .from("pathao_integrations")
            .select("allowed_store_ids")
            .eq("id", creds.id)
            .single();
          if (integ?.allowed_store_ids && Array.isArray(integ.allowed_store_ids) && integ.allowed_store_ids.length > 0) {
            allowed = integ.allowed_store_ids as number[];
          }
        }

        const stores = allowed.length > 0
          ? allStores.filter((s: any) => allowed.includes(s.store_id))
          : allStores;

        if (stores.length > 0) {
          await sb.from("pathao_stores").upsert(
            stores.map((s: any) => ({
              pathao_store_id: s.store_id,
              store_name: s.store_name,
              store_address: s.store_address || null,
              city_id: s.city_id || null,
              zone_id: s.zone_id || null,
              hub_id: s.hub_id || null,
              is_active: s.is_active === 1,
              integration_id: creds.id !== "env" ? creds.id : null,
              fetched_at: new Date().toISOString(),
            })),
            { onConflict: "pathao_store_id" }
          );
        }
        result = stores;
        break;
      }

      case "get_price": {
        const { store_id, item_type, delivery_type, item_weight, recipient_city, recipient_zone } = params;
        const data = await pathaoPost(
          token,
          "/aladdin/api/v1/merchant/price-plan",
          { store_id, item_type, delivery_type, item_weight, recipient_city, recipient_zone }
        );
        result = data.data || data;
        break;
      }

      case "create_order": {
        const { order_id, order_payload } = params;
        const data = await pathaoPost(token, "/aladdin/api/v1/orders", order_payload);
        const consignment_id = data.data?.consignment_id || data.consignment_id;

        if (order_id && consignment_id) {
          await sb.from("orders").update({
            consignment_id,
            tracking_status: "Pickup Pending",
            status: "shipped",
            pathao_integration_id: creds.id !== "env" ? creds.id : null,
            pathao_store_id: order_payload.store_id || null,
          }).eq("id", order_id);

          await sb.from("order_timeline").insert({
            order_id,
            event: "dispatched",
            description: `Dispatched to Pathao. Consignment: ${consignment_id}`,
            metadata: { consignment_id, integration_id: creds.id },
          });

          await postWooOrderNote(order_id, `[OmniSync] Dispatched to Pathao. Consignment: ${consignment_id}`);
        }

        result = { consignment_id, raw: data };
        break;
      }

      case "create_bulk": {
        const { orders } = params;
        const results: any[] = [];
        const CONCURRENCY = 5;
        for (let i = 0; i < orders.length; i += CONCURRENCY) {
          const chunk = orders.slice(i, i + CONCURRENCY);
          const chunkResults = await Promise.allSettled(
            chunk.map(async (entry: any) => {
              try {
                const data = await pathaoPost(token, "/aladdin/api/v1/orders", entry.order_payload);
                const consignment_id = data.data?.consignment_id || data.consignment_id;

                if (entry.order_id && consignment_id) {
                  await sb.from("orders").update({
                    consignment_id,
                    tracking_status: "Pickup Pending",
                    status: "shipped",
                    pathao_integration_id: creds.id !== "env" ? creds.id : null,
                    pathao_store_id: entry.order_payload.store_id || null,
                  }).eq("id", entry.order_id);

                  await sb.from("order_timeline").insert({
                    order_id: entry.order_id,
                    event: "dispatched",
                    description: `Dispatched to Pathao. Consignment: ${consignment_id}`,
                    metadata: { consignment_id, integration_id: creds.id },
                  });

                  await postWooOrderNote(entry.order_id, `[OmniSync] Dispatched to Pathao. Consignment: ${consignment_id}`);
                }

                return { order_id: entry.order_id, success: true, consignment_id };
              } catch (err: any) {
                return { order_id: entry.order_id, success: false, error: err.message };
              }
            })
          );
          for (const r of chunkResults) {
            results.push(r.status === "fulfilled" ? r.value : { success: false, error: String(r.reason) });
          }
        }
        result = { results };
        break;
      }

      case "track_order": {
        const { consignment_id } = params;
        const data = await pathaoGet(token, `/aladdin/api/v1/orders/${consignment_id}`);
        const info = data.data || data;
        const order_status = info.order_status || info.status;

        if (consignment_id) {
          const mappedStatus = mapPathaoStatus(order_status);
          const updateData: any = { tracking_status: order_status };
          if (mappedStatus) updateData.status = mappedStatus;
          await sb.from("orders").update(updateData).eq("consignment_id", consignment_id);

          // If newly delivered, push status back to WooCommerce as "completed"
          if (mappedStatus === "delivered") {
            const { data: ord } = await sb
              .from("orders")
              .select("id, woo_order_id, store_id")
              .eq("consignment_id", consignment_id)
              .maybeSingle();
            if (ord?.woo_order_id && ord?.store_id) {
              await pushOrderStatusToWoo(sb, ord.id).catch((e) =>
                console.warn(`woo-push from track_order failed: ${e?.message || e}`)
              );
            }
          }
        }
        result = info;
        break;
      }

      case "track_all": {
        // Track using ALL integrations: group orders by their pathao_integration_id and use that integration's token
        const { data: activeOrders } = await sb
          .from("orders")
          .select("id, consignment_id, tracking_status, pathao_integration_id")
          .not("consignment_id", "is", null)
          .not("status", "in", '("delivered","completed","cancelled","returned")');

        const trackResults: any[] = [];
        const tokenByIntegration = new Map<string, string>();
        tokenByIntegration.set(creds.id, token);

        for (const order of activeOrders || []) {
          try {
            let useToken = token;
            const intId = (order as any).pathao_integration_id as string | null;
            if (intId && intId !== creds.id) {
              if (!tokenByIntegration.has(intId)) {
                const otherCreds = await loadIntegration(sb, intId);
                tokenByIntegration.set(intId, await getAccessToken(otherCreds));
              }
              useToken = tokenByIntegration.get(intId)!;
            }

            const data = await pathaoGet(useToken, `/aladdin/api/v1/orders/${order.consignment_id}`);
            const info = data.data || data;
            const order_status = info.order_status || info.status;

            const mappedStatus = mapPathaoStatus(order_status);
            const updateData: any = { tracking_status: order_status };
            if (mappedStatus) updateData.status = mappedStatus;

            if (order.tracking_status !== order_status) {
              await sb.from("orders").update(updateData).eq("id", order.id);
              await sb.from("order_timeline").insert({
                order_id: order.id,
                event: "tracking_update",
                description: `Pathao status: ${order_status}`,
                metadata: { tracking_status: order_status },
              });

              await postWooOrderNote(order.id, `[OmniSync] Pathao status update: ${order_status}`);

              // If newly delivered, push status back to WooCommerce as "completed"
              if (mappedStatus === "delivered") {
                await pushOrderStatusToWoo(sb, order.id).catch((e) =>
                  console.warn(`woo-push from track_all failed for ${order.id}: ${e?.message || e}`)
                );
              }
            }

            trackResults.push({
              order_id: order.id,
              consignment_id: order.consignment_id,
              status: order_status,
              updated: order.tracking_status !== order_status,
            });
          } catch (err: any) {
            trackResults.push({
              order_id: order.id,
              consignment_id: order.consignment_id,
              error: err.message,
            });
          }
        }
        result = { tracked: trackResults.length, results: trackResults };
        break;
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify({ data: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("pathao-courier error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
