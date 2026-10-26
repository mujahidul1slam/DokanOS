import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface RestoreBody {
  order_id: string;
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

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Unauthorized: Missing Authorization header" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) {
      return json({ error: "Unauthorized: Invalid token" }, 401);
    }

    // Role check: staff or admin (H6)
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    const roles = (roleData || []).map((r: any) => r.role);
    const isStaffOrAdmin = roles.some((r: string) => r === "admin" || r === "staff");

    if (!isStaffOrAdmin) {
      // Also check business_members if applicable
      const { data: memberData } = await supabase
        .from("business_members")
        .select("role")
        .eq("user_id", user.id);
      const isMemberStaffOrAdmin = (memberData || []).some((m: any) =>
        m.role === "admin" || m.role === "staff" || m.role === "owner"
      );
      if (!isMemberStaffOrAdmin) {
        return json({ error: "Forbidden: Staff or admin role required" }, 403);
      }
    }

    const body = (await req.json()) as RestoreBody;
    const orderId = body?.order_id;
    if (!orderId) {
      return json({ error: "Missing order_id" }, 400);
    }

    // Invoke storefront_restore_stock RPC via service_role (H6)
    const { error: rpcErr } = await supabase.rpc("storefront_restore_stock", {
      p_order_id: orderId,
    });

    if (rpcErr) {
      return json({ error: rpcErr.message || "Failed to restore stock" }, 500);
    }

    return json({ success: true, message: "Inventory restored" });
  } catch (e: any) {
    return json({ error: e?.message || "Internal server error" }, 500);
  }
});
