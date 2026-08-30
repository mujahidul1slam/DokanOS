import { createClient } from "npm:@supabase/supabase-js@2.49.4";

Deno.serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: orders } = await supabase.from("orders").select("id, woo_order_id, order_number, status, total, customer_name").order("created_at", { ascending: false }).limit(5);
  const { data: webhooks } = await supabase.from("webhook_events").select("*").order("created_at", { ascending: false }).limit(5);

  return new Response(JSON.stringify({ orders, webhooks }, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
});
