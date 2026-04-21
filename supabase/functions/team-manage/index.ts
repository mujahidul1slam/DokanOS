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
      const normalizedEmail = String(email).trim().toLowerCase();

      // 1. Clear any stale pending invitation rows for this email so re-invite always works
      await supabase
        .from("invitations")
        .delete()
        .eq("email", normalizedEmail)
        .is("accepted_at", null);

      // 2. Look up existing auth user (paginate through users to find one)
      let existingUser: any = null;
      let page = 1;
      while (page <= 10) {
        const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
        if (listErr) break;
        existingUser = list.users.find((u: any) => (u.email || "").toLowerCase() === normalizedEmail);
        if (existingUser || list.users.length < 200) break;
        page++;
      }

      // 3. If user exists but never confirmed/accepted, delete so we can re-create cleanly.
      //    If user exists AND has a role assigned, they already accepted — block re-invite.
      let createdUserId: string | null = null;
      if (existingUser) {
        const { data: existingRole } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", existingUser.id)
          .maybeSingle();

        if (existingRole) {
          throw new Error("This user is already a team member");
        }

        // Stale auth user from prior failed invite — remove and recreate
        await supabase.auth.admin.deleteUser(existingUser.id);
      }

      // 4. Create fresh auth user
      const tempPassword = crypto.randomUUID() + "Aa1!";
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email: normalizedEmail,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { invited: true, invited_by: caller.id },
      });
      if (createError) throw createError;
      createdUserId = newUser.user?.id ?? null;

      // 5. Create invitation record
      const { error: invErr } = await supabase.from("invitations").insert({
        email: normalizedEmail,
        role,
        invited_by: caller.id,
      });
      if (invErr) throw invErr;

      // 6. Generate recovery link so the invited user can set their password
      const { error: linkErr } = await supabase.auth.admin.generateLink({
        type: "recovery",
        email: normalizedEmail,
      });
      if (linkErr) console.error("generateLink error:", linkErr.message);

      return new Response(JSON.stringify({
        success: true,
        message: `Invitation sent to ${normalizedEmail}`,
        user_id: createdUserId,
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
      if (!user_id) throw new Error("invite id required");
      await supabase.from("invitations").delete().eq("id", user_id);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error("Unknown action");
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
