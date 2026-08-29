import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PATHAO_BASE = "https://api-hermes.pathao.com";

// In-memory token cache per integration (lives for the function's runtime)
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

// Normalize status string: lowercase, replace underscores/hyphens with spaces, collapse whitespace
function normalizeStatus(s: string): string {
  return s.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

// Maps any Pathao tracking status to one of our 5 internal buckets:
// Pickup Pending + In Transit -> "shipped" | Delivered -> "delivered"
// On Hold -> "processing" | Returned -> "returned" | Cancelled -> "cancelled"
function mapPathaoStatus(status: string | null | undefined): string | undefined {
  if (!status) return undefined;
  const normalized = normalizeStatus(status);

  const rawStatusMap: Record<string, string> = {
    // Pickup lifecycle
    "pending": "shipped",
    "pickup pending": "shipped",
    "waiting for pickup": "shipped",
    "pickup requested": "shipped",
    "assigned for pickup": "shipped",
    "picked": "shipped",
    "picked up": "shipped",
    // Hub / transit lifecycle
    "at sorting hub": "shipped",
    "received at sorting hub": "shipped",
    "sent to sub sorting hub": "shipped",
    "received at sub sorting hub": "shipped",
    "sent to last mile hub": "shipped",
    "in transit": "shipped",
    "on the way to delivery hub": "shipped",
    "at delivery hub": "shipped",
    // Delivery lifecycle
    "assigned for delivery": "shipped",
    "sent for delivery": "shipped",
    "out for delivery": "shipped",
    "delivery confirmed": "shipped",
    "delivered": "delivered",
    "partial delivery": "delivered",
    "partial delivered": "delivered",
    "payment invoice": "delivered",
    // Return lifecycle
    "return": "returned",
    "returned": "returned",
    "paid return": "returned",
    "return requested": "returned",
    "return in transit": "returned",
    "returned to merchant": "returned",
    "merchant return": "returned",
    "return delivered": "returned",
    "delivery failed": "returned",
    "customer refused": "returned",
    "drt requested": "returned",
    "drt pick requested": "returned",
    "drt pick failed": "returned",
    "drt cancelled": "returned",
    "lost": "returned",
    "damaged": "returned",
    // Cancel / hold
    "cancelled": "cancelled",
    // Pickup never happened, so no shipment exists to track.
    "pickup cancel": "cancelled",
    "pickup cancelled": "cancelled",
    "pickup failed": "cancelled",
    "on hold": "processing",
    "pickup on hold": "processing",
    "on hold by customer request": "processing",
    "hold": "processing",
    "exchange": "processing",
  };

  const mapped = rawStatusMap[normalized];
  if (!mapped) {
    console.warn(`[pathao-courier] Unmapped Pathao status: "${status}" (normalized: "${normalized}")`);
  }
  return mapped;
}

// Enqueue a push_order so the linked WooCommerce order gets marked completed
// once the Pathao cycle terminates (delivered/returned). Uses the new
// store-aware queue — store_id is NOT NULL, so it must be looked up from the
// order before enqueueing.
async function pushOrderStatusToWoo(sb: any, orderId: string): Promise<void> {
  const { data: order, error: orderErr } = await sb
    .from("orders")
    .select("store_id")
    .eq("id", orderId)
    .maybeSingle();
  if (orderErr || !order?.store_id) {
    throw new Error(
      `Cannot queue woo-push for order ${orderId}: ${orderErr?.message || "no store_id"}`,
    );
  }
  const { error } = await sb.from("sync_queue").insert({
    store_id: order.store_id,
    order_id: orderId,
    action: "push_order",
    payload: { order_id: orderId },
  });
  if (error) {
    throw new Error(`Failed to queue woo-push: ${error.message}`);
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// GET with retry on 429 (rate-limit) and 5xx using exponential backoff +
// honoring the Retry-After header when Pathao provides one.
async function pathaoGet(token: string, path: string, maxRetries = 4) {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await fetch(`${PATHAO_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) return res.json();

    const txt = await res.text();
    const retriable = res.status === 429 || res.status >= 500;
    if (!retriable || attempt >= maxRetries) {
      throw new Error(`Pathao GET ${path} failed [${res.status}]: ${txt}`);
    }
    const retryAfterHeader = Number(res.headers.get("retry-after"));
    const backoffMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
      ? retryAfterHeader * 1000
      : Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 250);
    console.warn(`pathaoGet ${path} ${res.status}; retrying in ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries})`);
    await sleep(backoffMs);
    attempt++;
  }
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

    let callerId: string | null = null;
    let callerEmail: string | null = null;
    let callerName: string | null = null;

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
      callerId = caller.id;
      callerEmail = caller.email ?? null;
      const { data: prof } = await sb
        .from("profiles")
        .select("full_name")
        .eq("user_id", caller.id)
        .maybeSingle();
      callerName = (prof?.full_name as string | undefined) || callerEmail;
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
            metadata: {
              consignment_id,
              integration_id: creds.id,
              user_id: callerId,
              user_email: callerEmail,
              user_name: callerName,
            },
          });

          await sb.from("audit_log").insert({
            user_id: callerId,
            user_email: callerEmail,
            action: "dispatch",
            entity_type: "order",
            entity_id: order_id,
            details: { consignment_id, integration_id: creds.id, courier: "pathao" },
          });

          await postWooOrderNote(order_id, `[DokanOS] Dispatched to Pathao by ${callerName || callerEmail || "system"}. Consignment: ${consignment_id}`);
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
                    metadata: {
                      consignment_id,
                      integration_id: creds.id,
                      user_id: callerId,
                      user_email: callerEmail,
                      user_name: callerName,
                    },
                  });

                  await sb.from("audit_log").insert({
                    user_id: callerId,
                    user_email: callerEmail,
                    action: "dispatch",
                    entity_type: "order",
                    entity_id: entry.order_id,
                    details: { consignment_id, integration_id: creds.id, courier: "pathao" },
                  });

                  await postWooOrderNote(entry.order_id, `[DokanOS] Dispatched to Pathao by ${callerName || callerEmail || "system"}. Consignment: ${consignment_id}`);
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
        const orderStatusRaw = info.order_status ?? info.status ?? info.order_status_slug ?? "";
        const order_status = typeof orderStatusRaw === "string" ? orderStatusRaw.trim() : "";

        if (consignment_id) {
          const mappedStatus = mapPathaoStatus(order_status);
          const updateData: any = { tracking_status: order_status };
          if (mappedStatus) updateData.status = mappedStatus;
          await sb.from("orders").update(updateData).eq("consignment_id", consignment_id);

          const { data: ord } = await sb
            .from("orders")
            .select("id, woo_order_id, store_id, tracking_status")
            .eq("consignment_id", consignment_id)
            .maybeSingle();

          if (ord?.id && ord.tracking_status !== order_status) {
            await postWooOrderNote(ord.id, `[DokanOS] Pathao status update: ${order_status}`);
          }

          // Once the Pathao cycle has terminated (delivered/returned), close out the
          // linked WooCommerce order — woo-push maps both to "completed".
          if ((mappedStatus === "delivered" || mappedStatus === "returned") && ord?.woo_order_id && ord?.store_id) {
            await pushOrderStatusToWoo(sb, ord.id).catch((e) =>
              console.warn(`woo-push from track_order failed: ${e?.message || e}`)
            );
          }
        }
        result = info;
        break;
      }

      case "track_all": {
        const { order_ids } = params;

        let query = sb
          .from("orders")
          .select("id, consignment_id, tracking_status, pathao_integration_id")
          .not("consignment_id", "is", null);

        if (order_ids && Array.isArray(order_ids) && order_ids.length > 0) {
          query = query.in("id", order_ids);
        } else {
          query = query.not("status", "in", '("delivered","completed","cancelled","returned")');
        }

        // Order by last_tracked_at, not updated_at: updated_at only moves when a
        // status actually changes, so terminal-but-still-open orders kept their
        // original timestamp and permanently occupied this 50-row window. Every
        // order below is stamped whether or not it changed, so the window
        // rotates through the whole active set instead of deadlocking.
        const { data: activeOrders } = await query
          .order("last_tracked_at", { ascending: true, nullsFirst: true })
          .limit(50);

        const trackResults: any[] = [];
        const tokenByIntegration = new Map<string, string>();
        tokenByIntegration.set(creds.id, token);

        for (let i = 0; i < (activeOrders || []).length; i++) {
          const order = activeOrders![i];
          // Pace requests to stay under Pathao's per-minute rate limit.
          // 350ms ≈ ~170 req/min headroom; combined with retry-on-429 backoff
          // inside pathaoGet this keeps the loop reliable for large batches.
          if (i > 0) await sleep(350);
          // Stamped in `finally` below so that *every* outcome — changed,
          // unchanged, unusable status, or a thrown error — moves this order to
          // the back of the queue. If any path could skip the stamp, that order
          // would keep last_tracked_at = NULL, sort first forever (NULLS FIRST)
          // and re-jam the window exactly like updated_at did.
          let stamped = false;
          const polledAt = new Date().toISOString();
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
            const orderStatusRaw = info.order_status ?? info.status ?? info.order_status_slug;
            const order_status = typeof orderStatusRaw === "string" ? orderStatusRaw.trim() : "";

            if (!order_status || order_status.toLowerCase() === "undefined" || order_status.toLowerCase() === "null") {
              continue;
            }

            const mappedStatus = mapPathaoStatus(order_status);
            const updateData: any = { tracking_status: order_status, last_tracked_at: polledAt };
            if (mappedStatus) updateData.status = mappedStatus;

            if (order.tracking_status !== order_status) {
              const { error: updErr } = await sb.from("orders").update(updateData).eq("id", order.id);
              // Only claim the stamp landed if the write actually succeeded —
              // otherwise fall through to the `finally` stamp, or this order
              // would keep a NULL cursor and re-jam the queue.
              stamped = !updErr;
              if (updErr) throw new Error(`orders update failed: ${updErr.message}`);
              await sb.from("order_timeline").insert({
                order_id: order.id,
                event: "tracking_update",
                description: `Pathao courier status: ${order_status}`,
                metadata: {
                  tracking_status: order_status,
                  mapped_status: mappedStatus,
                  previous_status: order.tracking_status,
                  user_name: "Pathao Tracking",
                  user_email: null,
                },
              });

              await postWooOrderNote(order.id, `[DokanOS] Pathao status update: ${order_status}`);

              // Once the Pathao cycle has terminated (delivered/returned), close out the
              // linked WooCommerce order — woo-push maps both to "completed".
              if (mappedStatus === "delivered" || mappedStatus === "returned") {
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
          } finally {
            if (!stamped) {
              // supabase-js resolves with { error } instead of rejecting, so read
              // the error rather than relying on a catch handler here.
              const { error: stampErr } = await sb.from("orders")
                .update({ last_tracked_at: polledAt })
                .eq("id", order.id);
              if (stampErr) {
                console.warn(`last_tracked_at stamp failed for ${order.id}: ${stampErr.message}`);
              }
            }
          }
        }
        const updatedCount = trackResults.filter((r) => r.updated).length;
        // `total`/`updated` are what the Orders and Dispatch toasts read; keep
        // them in sync with those callers or the UI silently reports 0/0.
        result = {
          tracked: trackResults.length,
          total: trackResults.length,
          updated: updatedCount,
          results: trackResults,
        };
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
