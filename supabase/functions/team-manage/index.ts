import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
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

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user: caller } } = await supabase.auth.getUser(token);
    if (!caller) throw new Error("Unauthorized");

    const { data: callerRole } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .single();

    if (callerRole?.role !== "admin") throw new Error("Admin access required");

    // Unpaginated auth lookup via get_auth_signup_state RPC
    async function resolveTargetUser(targetEmail: string) {
      const { data: list, error } = await supabase.rpc("get_auth_signup_state", {
        p_email: targetEmail,
      });
      if (error || !list || list.length === 0) return null;

      if (list.length === 1) return list[0];

      // Ambiguity rule: exact match wins; multiple matches with no exact match => throw ambiguous error
      const exact = list.find((u: any) => (u.email || "").toLowerCase() === targetEmail.toLowerCase());
      if (exact) return exact;

      throw new Error("AMBIGUOUS_TARGET: multiple accounts match this email variant");
    }

    // ========== INVITE (Five-route spec per SIGNUP-PLAN §7) ==========
    if (action === "invite") {
      if (!email || !role) throw new Error("Email and role are required");
      const normalizedEmail = String(email).trim().toLowerCase();

      const existingUser = await resolveTargetUser(normalizedEmail);

      if (existingUser) {
        // Check UBA membership
        const { data: ubaRows } = await supabase
          .from("user_business_access")
          .select("id")
          .eq("user_id", existingUser.id)
          .limit(1);
        const hasUba = (ubaRows || []).length > 0;
        const isConfirmed = !!existingUser.email_confirmed_at;
        const isInvited = !!existingUser.invited_at;

        // Route a & b: User WITH UBA OR Confirmed user (no UBA) -> direct attach staff role
        if (hasUba || isConfirmed) {
          // Check existing role
          const { data: existingRole } = await supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", existingUser.id)
            .eq("role", role)
            .maybeSingle();

          if (!existingRole) {
            await supabase.from("user_roles").insert({
              user_id: existingUser.id,
              role,
            });
          }

          // Synthetic invitations row for audit parity
          await supabase.from("invitations").insert({
            email: normalizedEmail,
            role,
            invited_by: caller.id,
            accepted_at: new Date().toISOString(),
          });

          // Audit in signup_events
          await supabase.from("signup_events").insert({
            event: "staff_role_attached",
            email: normalizedEmail,
            user_id: existingUser.id,
            meta: { invited_by: caller.id, target_role: role },
          });

          // Send notification/recovery email
          const redirectTo = `${req.headers.get("origin") || ""}/login`;
          try {
            await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo });
          } catch (mailErr) {
            console.warn("Notice email send failed:", mailErr);
          }

          return new Response(
            JSON.stringify({
              success: true,
              message: `${role} role attached to existing account ${normalizedEmail}`,
              user_id: existingUser.id,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Route e: Pending invitee re-invite (invited_at IS NOT NULL, unconfirmed) -> native re-send
        if (isInvited && !isConfirmed) {
          await supabase
            .from("invitations")
            .delete()
            .eq("email", normalizedEmail)
            .is("accepted_at", null);

          await supabase.from("invitations").insert({
            email: normalizedEmail,
            role,
            invited_by: caller.id,
          });

          const redirectTo = `${req.headers.get("origin") || ""}/reset-password`;
          const { data: invited, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(
            normalizedEmail,
            { redirectTo, data: { invited_by: caller.id } }
          );
          if (inviteErr) throw new Error(`Email send failed: ${inviteErr.message}`);

          return new Response(
            JSON.stringify({
              success: true,
              message: `Invitation re-sent to ${normalizedEmail}`,
              user_id: invited.user?.id ?? null,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Check unconsumed signup_started anchor
        const { data: unconsumedAnchor } = await supabase
          .from("signup_events")
          .select("id, created_at")
          .eq("event", "signup_started")
          .eq("email", normalizedEmail)
          .neq("meta->>consumed", "true")
          .order("created_at", { ascending: false })
          .limit(1);

        const hasAnchor = (unconsumedAnchor || []).length > 0;

        // Check user age
        const { data: fullUser } = await supabase.auth.admin.getUserById(existingUser.id);
        const createdAt = fullUser?.user?.created_at ? new Date(fullUser.user.created_at).getTime() : 0;
        const ageHours = (Date.now() - createdAt) / (3600 * 1000);

        // Route d: Unconfirmed, no invite, AND (anchor present OR age <= 48 h) -> typed no-op
        if (!isInvited && !isConfirmed && (hasAnchor || ageHours <= 48)) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "PENDING_SETUP",
              message: "This account has a pending self-serve setup. No action taken.",
              user_id: existingUser.id,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Route c: Stale-delete ONLY when: no UBA, no unconsumed anchor, invited_at IS NULL, unconfirmed, age > 48h
        if (!hasUba && !hasAnchor && !isInvited && !isConfirmed && ageHours > 48) {
          await supabase.auth.admin.deleteUser(existingUser.id);
        }
      }

      // Fresh invite flow
      await supabase
        .from("invitations")
        .delete()
        .eq("email", normalizedEmail)
        .is("accepted_at", null);

      await supabase.from("invitations").insert({
        email: normalizedEmail,
        role,
        invited_by: caller.id,
      });

      const redirectTo = `${req.headers.get("origin") || ""}/reset-password`;
      const { data: invited, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(
        normalizedEmail,
        { redirectTo, data: { invited_by: caller.id } }
      );

      if (inviteErr) {
        await supabase.from("invitations").delete().eq("email", normalizedEmail).is("accepted_at", null);
        throw new Error(`Email send failed: ${inviteErr.message}`);
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: `Invitation email sent to ${normalizedEmail}`,
          user_id: invited.user?.id ?? null,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ========== CREATE USER WITH PASSWORD ==========
    if (action === "create_with_password") {
      if (!email || !role || !password) {
        throw new Error("Email, role, and password are required");
      }
      if (String(password).length < 8) {
        throw new Error("Password must be at least 8 characters");
      }
      const normalizedEmail = String(email).trim().toLowerCase();

      const existingUser = await resolveTargetUser(normalizedEmail);
      if (existingUser) {
        const { data: existingRole } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", existingUser.id)
          .maybeSingle();
        if (existingRole) throw new Error("This user already exists");
        await supabase.auth.admin.deleteUser(existingUser.id);
      }

      await supabase.from("invitations").delete().eq("email", normalizedEmail).is("accepted_at", null);

      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email: normalizedEmail,
        password,
        email_confirm: true,
        user_metadata: { full_name: full_name || normalizedEmail, created_by_admin: caller.id },
      });
      if (createErr) throw createErr;

      const newUserId = created.user?.id;
      if (!newUserId) throw new Error("User creation failed");

      await supabase.from("user_roles").delete().eq("user_id", newUserId);
      const { error: roleErr } = await supabase
        .from("user_roles")
        .insert({ user_id: newUserId, role });
      if (roleErr) throw roleErr;

      await supabase.from("invitations").insert({
        email: normalizedEmail,
        role,
        invited_by: caller.id,
        accepted_at: new Date().toISOString(),
      });

      return new Response(
        JSON.stringify({
          success: true,
          message: `User created. Share these credentials with them.`,
          user_id: newUserId,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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
        const { error: recErr } = await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo });
        if (recErr) throw new Error(`Resend failed: ${resendErr.message}`);
      }
      return new Response(
        JSON.stringify({ success: true, message: `Invitation re-sent to ${normalizedEmail}` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    throw new Error("Unknown action");
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
