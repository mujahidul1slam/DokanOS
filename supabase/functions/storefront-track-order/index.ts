import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface TrackBody {
  order_number: string;
  phone: string;
}

function normalizePhone(input: string): string {
  return (input || "").replace(/\D/g, "");
}

function phoneMatches(inputPhone: string, storedPhone: string): boolean {
  const normInput = normalizePhone(inputPhone);
  const normStored = normalizePhone(storedPhone);
  if (!normInput || !normStored) return false;
  if (normInput === normStored) return true;
  // Match last 6 digits if length >= 6
  if (normInput.length >= 6 && normStored.length >= 6) {
    return normInput.slice(-6) === normStored.slice(-6);
  }
  return false;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status,
    });

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const body = (await req.json()) as TrackBody;
    const orderNumber = (body?.order_number || "").trim();
    const phone = (body?.phone || "").trim();

    if (!orderNumber || !phone) {
      return json({ error: "Order number and phone number are required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Query order using service_role since orders anon read policy is dropped (H1/H5)
    const { data: order, error } = await supabase
      .from("orders")
      .select("order_number, status, tracking_status, payment_status, total, created_at, consignment_id, customer_phone")
      .eq("order_number", orderNumber)
      .maybeSingle();

    if (error || !order) {
      return json({ error: "Order not found" }, 404);
    }

    // Phone verification: prevent enumeration / oracle (audit §2.9.1 / H1)
    if (!order.customer_phone || !phoneMatches(phone, order.customer_phone)) {
      return json({ error: "Order not found" }, 404);
    }

    // Return limited safe fields without customer PII
    return json({
      order_number: order.order_number,
      status: order.status,
      tracking_status: order.tracking_status,
      payment_status: order.payment_status,
      total: order.total,
      created_at: order.created_at,
      consignment_id: order.consignment_id,
    });
  } catch (e: any) {
    return json({ error: e?.message || "Internal server error" }, 500);
  }
});
