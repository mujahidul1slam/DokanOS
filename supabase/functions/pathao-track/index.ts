import { createClient } from "npm:@supabase/supabase-js@2.49.4";

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

/** Mirror an order timeline entry to the linked WooCommerce order's notes timeline. */
async function postWooNote(orderId: string, note: string) {
  try {
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/woo-push`;
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({ action: "post_note", order_id: orderId, note, customer_note: false }),
    });
  } catch (e) {
    console.warn("postWooNote failed:", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify caller is authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: { user: caller }, error: authErr } = await sb.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authErr || !caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = await getAccessToken();

    // Get all active shipments
    const { data: activeOrders } = await sb
      .from("orders")
      .select("id, consignment_id, tracking_status, status")
      .not("consignment_id", "is", null)
      .not("status", "in", '("delivered","completed","cancelled","returned")');

    const statusMap: Record<string, string> = {
      "Pending": "shipped",
      "Pickup Pending": "shipped",
      "Pickup Requested": "shipped",
      "Assigned for Pickup": "shipped",
      "Picked": "shipped",
      "Picked Up": "shipped",
      "Pickup Cancel": "shipped",
      "Pickup Cancelled": "shipped",
      "Pickup Failed": "shipped",
      "At Sorting Hub": "shipped",
      "In Transit": "shipped",
      "On the Way To Delivery Hub": "shipped",
      "At Delivery Hub": "shipped",
      "Out for Delivery": "shipped",
      "Delivered": "delivered",
      "Partial Delivered": "delivered",
      "Payment Invoice": "delivered",
      "Return": "returned",
      "Returned": "returned",
      "Paid Return": "returned",
      "Return Requested": "returned",
      "Return In Transit": "returned",
      "Returned to Merchant": "returned",
      "Merchant Return": "returned",
      "Return Delivered": "returned",
      "Delivery Failed": "returned",
      "Customer Refused": "returned",
      "Cancelled": "cancelled",
      "On Hold": "processing",
      "Hold": "processing",
      "Exchange": "processing",
    };

    let updated = 0;
    const errors: string[] = [];

    for (const order of activeOrders || []) {
      try {
        const res = await fetch(
          `${PATHAO_BASE}/aladdin/api/v1/orders/${order.consignment_id}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) {
          const txt = await res.text();
          errors.push(`${order.consignment_id}: ${txt}`);
          continue;
        }
        const data = await res.json();
        const info = data.data || data;
        const pathaoStatusRaw = info.order_status ?? info.status ?? info.order_status_slug;
        const pathaoStatus = typeof pathaoStatusRaw === "string" ? pathaoStatusRaw.trim() : "";

        if (!pathaoStatus || pathaoStatus.toLowerCase() === "undefined" || pathaoStatus.toLowerCase() === "null") {
          // Don't pollute timeline with bogus values
          continue;
        }

        if (pathaoStatus !== order.tracking_status) {
          const mappedStatus = statusMap[pathaoStatus] || order.status;
          await sb
            .from("orders")
            .update({
              tracking_status: pathaoStatus,
              status: mappedStatus,
            })
            .eq("id", order.id);

          await sb.from("order_timeline").insert({
            order_id: order.id,
            event: "tracking_update",
            description: `Pathao courier status: ${pathaoStatus}`,
            metadata: {
              tracking_status: pathaoStatus,
              mapped_status: mappedStatus,
              previous_status: order.tracking_status,
              user_name: "Pathao Tracking",
              user_email: null,
            },
          });

          // Explicit cancelled entry on Pathao pickup-cancel/failure transitions
          const PICKUP_CANCEL_STATUSES = ["Pickup Cancel", "Pickup Cancelled", "Pickup Failed", "Cancelled"];
          const wasPickupCancel = PICKUP_CANCEL_STATUSES.includes(order.tracking_status || "");
          const isPickupCancel = PICKUP_CANCEL_STATUSES.includes(pathaoStatus);
          if (isPickupCancel && !wasPickupCancel) {
            await sb.from("order_timeline").insert({
              order_id: order.id,
              event: "cancelled",
              description: `Order cancelled by Pathao courier (${pathaoStatus})`,
              metadata: {
                source: "pathao_track",
                tracking_status: pathaoStatus,
                previous_status: order.tracking_status,
                user_name: "Pathao Tracking",
                user_email: null,
              },
            });
            await sb.from("audit_log").insert({
              action: "order_cancelled",
              entity_type: "order",
              entity_id: order.id,
              user_email: "pathao@system",
              details: {
                source: "pathao_track",
                tracking_status: pathaoStatus,
                previous_status: order.tracking_status,
                consignment_id: order.consignment_id,
              },
            });
            await postWooNote(order.id, `[DokanOS] Order cancelled by Pathao courier (${pathaoStatus}) — by Pathao Tracking`);
          }

          // Mirror status update into WooCommerce notes timeline (no-op for non-Woo orders)
          await postWooNote(order.id, `[DokanOS] Pathao courier status: ${pathaoStatus} — by Pathao Tracking`);

          // Once the Pathao cycle has terminated (delivered/returned), close out the
          // linked WooCommerce order — woo-push maps both to "completed".
          if (mappedStatus === "delivered" || mappedStatus === "returned") {
            try {
              const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/woo-push`;
              await fetch(url, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                },
                body: JSON.stringify({ action: "push_order", order_id: order.id }),
              });
            } catch (e) {
              console.warn(`woo-push from pathao-track failed for ${order.id}:`, e);
            }
          }

          updated++;
        }
      } catch (err: any) {
        errors.push(`${order.consignment_id}: ${err.message}`);
      }
    }

    return new Response(
      JSON.stringify({
        data: {
          total: (activeOrders || []).length,
          updated,
          errors: errors.length,
          error_details: errors.slice(0, 10),
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("pathao-track error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
