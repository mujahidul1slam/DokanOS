import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email, role, action, user_id, password, full_name } = await req.json();

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

    // Helper: find existing auth user by email (paginated)
    async function findUserByEmail(targetEmail: string) {
      let page = 1;
      while (page <= 20) {
        const { data: list, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
        if (error) return null;
        const found = list.users.find((u: any) => (u.email || "").toLowerCase() === targetEmail);
        if (found) return found;
        if (list.users.length < 200) return null;
        page++;
      }
      return null;
    }

    // ========== INVITE (sends invitation email via Supabase built-in mailer) ==========
    if (action === "invite") {
      if (!email || !role) throw new Error("Email and role are required");
      const normalizedEmail = String(email).trim().toLowerCase();

      // Clear stale pending invitation rows
      await supabase
        .from("invitations")
        .delete()
        .eq("email", normalizedEmail)
        .is("accepted_at", null);

      // Check existing user
      const existingUser = await findUserByEmail(normalizedEmail);
      if (existingUser) {
        const { data: existingRole } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", existingUser.id)
          .maybeSingle();

        if (existingRole) {
          throw new Error("This user is already an active team member");
        }

        // Stale auth user — delete to allow fresh invite
        await supabase.auth.admin.deleteUser(existingUser.id);
      }

      // Insert invitation row first (so handle_new_user trigger picks the right role)
      const { error: invErr } = await supabase.from("invitations").insert({
        email: normalizedEmail,
        role,
        invited_by: caller.id,
      });
      if (invErr) throw invErr;

      // Send the actual invite email through Supabase Auth
      // (uses Supabase's built-in SMTP — sender is "noreply@mail.app.supabase.io" by default)
      const redirectTo = `${req.headers.get("origin") || ""}/reset-password`;
      const { data: invited, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(
        normalizedEmail,
        { redirectTo, data: { invited_by: caller.id } }
      );
      if (inviteErr) {
        // Roll back invitation row on failure
        await supabase.from("invitations").delete().eq("email", normalizedEmail).is("accepted_at", null);
        throw new Error(`Email send failed: ${inviteErr.message}`);
      }

      return new Response(JSON.stringify({
        success: true,
        message: `Invitation email sent to ${normalizedEmail}`,
        user_id: invited.user?.id ?? null,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========== CREATE USER WITH PASSWORD (no email sent — admin sets credentials directly) ==========
    if (action === "create_with_password") {
      if (!email || !role || !password) {
        throw new Error("Email, role, and password are required");
      }
      if (String(password).length < 8) {
        throw new Error("Password must be at least 8 characters");
      }
      const normalizedEmail = String(email).trim().toLowerCase();

      // Block if user already exists with a role
      const existingUser = await findUserByEmail(normalizedEmail);
      if (existingUser) {
        const { data: existingRole } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", existingUser.id)
          .maybeSingle();
        if (existingRole) throw new Error("This user already exists");
        // stale — clean up
        await supabase.auth.admin.deleteUser(existingUser.id);
      }

      // Clean up any pending invitation
      await supabase.from("invitations").delete().eq("email", normalizedEmail).is("accepted_at", null);

      // Create confirmed user with the given password
      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email: normalizedEmail,
        password,
        email_confirm: true,
        user_metadata: { full_name: full_name || normalizedEmail, created_by_admin: caller.id },
      });
      if (createErr) throw createErr;

      const newUserId = created.user?.id;
      if (!newUserId) throw new Error("User creation failed");

      // Assign role directly (handle_new_user trigger only assigns on invitation match).
      // user_roles unique constraint is on (user_id, role), not user_id alone — so we
      // delete any existing rows for this user first, then insert the chosen role.
      await supabase.from("user_roles").delete().eq("user_id", newUserId);
      const { error: roleErr } = await supabase
        .from("user_roles")
        .insert({ user_id: newUserId, role });
      if (roleErr) throw roleErr;

      // Mark a synthetic invitation as accepted for audit trail
      await supabase.from("invitations").insert({
        email: normalizedEmail,
        role,
        invited_by: caller.id,
        accepted_at: new Date().toISOString(),
      });

      return new Response(JSON.stringify({
        success: true,
        message: `User created. Share these credentials with them.`,
        user_id: newUserId,
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

    if (action === "resend_invite") {
      if (!email) throw new Error("Email required");
      const normalizedEmail = String(email).trim().toLowerCase();
      const redirectTo = `${req.headers.get("origin") || ""}/reset-password`;
      const { error: resendErr } = await supabase.auth.admin.inviteUserByEmail(
        normalizedEmail,
        { redirectTo }
      );
      if (resendErr) {
        // Fallback: send password recovery if user already exists
        const { error: recErr } = await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo });
        if (recErr) throw new Error(`Resend failed: ${resendErr.message}`);
      }
      return new Response(JSON.stringify({ success: true, message: `Invitation re-sent to ${normalizedEmail}` }), {
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
