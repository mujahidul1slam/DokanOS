import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PATHAO_BASE = "https://api-hermes.pathao.com";

async function getAccessToken(): Promise<string> {
  const res = await fetch(`${PATHAO_BASE}/aladdin/api/v1/issue-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: Deno.env.get("PATHAO_CLIENT_ID"),
      client_secret: Deno.env.get("PATHAO_CLIENT_SECRET"),
      username: Deno.env.get("PATHAO_USERNAME"),
      password: Deno.env.get("PATHAO_PASSWORD"),
      grant_type: "password",
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Pathao auth failed [${res.status}]: ${txt}`);
  }
  const data = await res.json();
  return data.access_token;
}

function supabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
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
    const { action, ...params } = await req.json();
    const token = await getAccessToken();
    const sb = supabaseAdmin();

    let result: unknown;

    switch (action) {
      // ── Fetch & cache cities ──
      case "get_cities": {
        const data = await pathaoGet(
          token,
          "/aladdin/api/v1/countries/1/city-list"
        );
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

      // ── Fetch & cache zones for a city ──
      case "get_zones": {
        const { city_id } = params;
        const data = await pathaoGet(
          token,
          `/aladdin/api/v1/cities/${city_id}/zone-list`
        );
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

      // ── Fetch & cache areas for a zone ──
      case "get_areas": {
        const { zone_id } = params;
        const data = await pathaoGet(
          token,
          `/aladdin/api/v1/zones/${zone_id}/area-list`
        );
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

      // ── Fetch & cache Pathao merchant stores ──
      case "get_stores": {
        const data = await pathaoGet(
          token,
          "/aladdin/api/v1/stores"
        );
        const stores = data.data?.data || data.data || [];
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
              fetched_at: new Date().toISOString(),
            })),
            { onConflict: "pathao_store_id" }
          );
        }
        result = stores;
        break;
      }

      // ── Get price calculation ──
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

      // ── Create single order ──
      case "create_order": {
        const { order_id, order_payload } = params;
        const data = await pathaoPost(
          token,
          "/aladdin/api/v1/orders",
          order_payload
        );
        const consignment_id =
          data.data?.consignment_id || data.consignment_id;

        // Update local order
        if (order_id && consignment_id) {
          await sb
            .from("orders")
            .update({
              consignment_id,
              tracking_status: "Pickup Pending",
              status: "shipped",
            })
            .eq("id", order_id);

          // Add timeline entry
          await sb.from("order_timeline").insert({
            order_id,
            event: "dispatched",
            description: `Dispatched to Pathao. Consignment: ${consignment_id}`,
            metadata: { consignment_id },
          });
        }

        result = { consignment_id, raw: data };
        break;
      }

      // ── Bulk create orders ──
      case "create_bulk": {
        const { orders } = params; // array of { order_id, order_payload }
        const results: any[] = [];

        // Process orders sequentially to avoid rate limits, with concurrency for DB updates
        const CONCURRENCY = 5;
        for (let i = 0; i < orders.length; i += CONCURRENCY) {
          const chunk = orders.slice(i, i + CONCURRENCY);
          const chunkResults = await Promise.allSettled(
            chunk.map(async (entry: any) => {
              try {
                const data = await pathaoPost(
                  token,
                  "/aladdin/api/v1/orders",
                  entry.order_payload
                );
                const consignment_id =
                  data.data?.consignment_id || data.consignment_id;

                if (entry.order_id && consignment_id) {
                  await sb
                    .from("orders")
                    .update({
                      consignment_id,
                      tracking_status: "Pickup Pending",
                      status: "shipped",
                    })
                    .eq("id", entry.order_id);

                  await sb.from("order_timeline").insert({
                    order_id: entry.order_id,
                    event: "dispatched",
                    description: `Dispatched to Pathao. Consignment: ${consignment_id}`,
                    metadata: { consignment_id },
                  });
                }

                return {
                  order_id: entry.order_id,
                  success: true,
                  consignment_id,
                };
              } catch (err: any) {
                return {
                  order_id: entry.order_id,
                  success: false,
                  error: err.message,
                };
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

      // ── Track single consignment ──
      case "track_order": {
        const { consignment_id } = params;
        const data = await pathaoGet(
          token,
          `/aladdin/api/v1/orders/${consignment_id}`
        );
        const info = data.data || data;
        const order_status = info.order_status || info.status;

        // Update the order in DB if we can match it
        if (consignment_id) {
          const statusMap: Record<string, string> = {
            "Pending": "processing",
            "Pickup Pending": "shipped",
            "Picked": "shipped",
            "In Transit": "shipped",
            "Delivered": "delivered",
            "Partial Delivered": "delivered",
            "Return": "returned",
            "Returned": "returned",
            "Exchange": "processing",
            "On Hold": "processing",
            "Cancelled": "cancelled",
          };

          const mappedStatus = statusMap[order_status] || undefined;

          const updateData: any = {
            tracking_status: order_status,
          };
          if (mappedStatus) {
            updateData.status = mappedStatus;
          }

          await sb
            .from("orders")
            .update(updateData)
            .eq("consignment_id", consignment_id);
        }

        result = info;
        break;
      }

      // ── Bulk track all active consignments ──
      case "track_all": {
        const { data: activeOrders } = await sb
          .from("orders")
          .select("id, consignment_id, tracking_status")
          .not("consignment_id", "is", null)
          .not("status", "in", '("delivered","completed","cancelled","returned")');

        const trackResults: any[] = [];

        for (const order of activeOrders || []) {
          try {
            const data = await pathaoGet(
              token,
              `/aladdin/api/v1/orders/${order.consignment_id}`
            );
            const info = data.data || data;
            const order_status = info.order_status || info.status;

            const statusMap: Record<string, string> = {
              "Pending": "processing",
              "Pickup Pending": "shipped",
              "Picked": "shipped",
              "In Transit": "shipped",
              "Delivered": "delivered",
              "Partial Delivered": "delivered",
              "Return": "returned",
              "Returned": "returned",
              "Cancelled": "cancelled",
            };

            const mappedStatus = statusMap[order_status] || undefined;
            const updateData: any = { tracking_status: order_status };
            if (mappedStatus) updateData.status = mappedStatus;

            // Only update if status actually changed
            if (order.tracking_status !== order_status) {
              await sb
                .from("orders")
                .update(updateData)
                .eq("id", order.id);

              await sb.from("order_timeline").insert({
                order_id: order.id,
                event: "tracking_update",
                description: `Pathao status: ${order_status}`,
                metadata: { tracking_status: order_status },
              });
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
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
    }

    return new Response(JSON.stringify({ data: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("pathao-courier error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
