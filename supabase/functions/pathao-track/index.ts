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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const token = await getAccessToken();
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get all active shipments
    const { data: activeOrders } = await sb
      .from("orders")
      .select("id, consignment_id, tracking_status, status")
      .not("consignment_id", "is", null)
      .not("status", "in", '("delivered","completed","cancelled","returned")');

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
        const pathaoStatus = info.order_status || info.status;

        if (pathaoStatus && pathaoStatus !== order.tracking_status) {
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
            description: `Pathao status: ${pathaoStatus}`,
            metadata: { tracking_status: pathaoStatus },
          });

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
