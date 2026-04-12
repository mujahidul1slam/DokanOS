import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email, role, action, user_id } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify the caller is an admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");
    
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller } } = await supabase.auth.getUser(token);
    if (!caller) throw new Error("Unauthorized");

    const { data: callerRole } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .single();
    
    if (callerRole?.role !== "admin") throw new Error("Admin access required");

    if (action === "invite") {
      if (!email || !role) throw new Error("Email and role are required");

      // Check for existing invitation
      const { data: existing } = await supabase
        .from("invitations")
        .select("id")
        .eq("email", email)
        .is("accepted_at", null)
        .maybeSingle();

      if (existing) throw new Error("This email already has a pending invitation");

      // Create the auth user with a temporary password
      const tempPassword = crypto.randomUUID() + "Aa1!";
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { invited: true, invited_by: caller.id },
      });

      if (createError) {
        if (createError.message.includes("already been registered")) {
          throw new Error("This email is already registered");
        }
        throw createError;
      }

      // Create invitation record
      await supabase.from("invitations").insert({
        email,
        role,
        invited_by: caller.id,
      });

      // Send password reset so the invited user can set their own password
      await supabase.auth.admin.generateLink({
        type: "recovery",
        email,
      });

      return new Response(JSON.stringify({ 
        success: true, 
        message: `Invitation sent to ${email}`,
        user_id: newUser.user?.id 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "update_role") {
      if (!user_id || !role) throw new Error("user_id and role are required");
      
      const { error } = await supabase
        .from("user_roles")
        .update({ role })
        .eq("user_id", user_id);
      
      if (error) throw error;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "delete_invite") {
      const { id } = await req.json().catch(() => ({ id: null }));
      if (!user_id) throw new Error("invite id required");
      
      await supabase.from("invitations").delete().eq("id", user_id);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error("Unknown action");
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
