import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import dokanosLogo from "@/assets/dokanos-logo-stacked.png";
import { invitationPath } from "@/lib/invitationPath";
import { initialAuthCallbackType } from "@/lib/authCallbackIntent";
import { POST_LOGIN_STATE } from "@/lib/accounts/landing";
import { profileSetupOwed } from "@/lib/accounts/profileSetup";

/** True when the verified person still owes the one-time setup. A read failure is not owed. */
const profileSetupIsOwed = async (userId: string): Promise<boolean> => {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("profile_setup_completed_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return false;
    return profileSetupOwed(data);
  } catch {
    return false;
  }
};

/** Authentication callbacks never create business resources or accept invitations. */
export default function AuthConfirm() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function confirm() {
      try {
        const hash = new URLSearchParams(window.location.hash.slice(1));
        if (params.has("error") || hash.has("error")) {
          throw new Error("This confirmation link is invalid or expired. Sign in or request a new link.");
        }
        let { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!session) {
          // Allow the auth client to finish exchanging a callback URL.
          await new Promise((resolve) => setTimeout(resolve, 1200));
          const result = await supabase.auth.getSession();
          session = result.data.session;
          error = result.error;
          if (error) throw error;
        }
        if (!active) return;
        if (!session?.user.email_confirmed_at) {
          setMessage("Sign in with your verified email to continue. No business setup is required.");
          return;
        }
        const recovery = params.get("type") === "recovery" || hash.get("type") === "recovery" || initialAuthCallbackType === "recovery";
        if (recovery) {
          navigate(invitationPath("/reset-password", params), { replace: true });
          return;
        }
        // Task 3: the one-time profile setup comes after verification and before the
        // business flow. A read failure never traps the person here: it falls through
        // to the business flow as before.
        const owed = await profileSetupIsOwed(session.user.id);
        if (!active) return;
        if (owed) {
          navigate(invitationPath("/profile/setup", params), { replace: true });
          return;
        }
        navigate(invitationPath("/accounts", params), { replace: true, state: POST_LOGIN_STATE });
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "Could not verify your confirmation link.");
      }
    }
    confirm();
    return () => { active = false; };
  }, [navigate, params]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <img src={dokanosLogo} alt="DokanOS" className="mx-auto h-20 w-auto object-contain" />
          <CardTitle>{message ? "Continue to your personal account" : "Confirming your email"}</CardTitle>
          <CardDescription>{message || "Verifying your email confirmation link..."}</CardDescription>
        </CardHeader>
        <CardContent>
          {message ? (
            <div className="space-y-3">
              <Button asChild className="w-full"><Link to={invitationPath("/login", params)}>Sign in to continue</Link></Button>
              <Button asChild variant="outline" className="w-full"><Link to={invitationPath("/check-email", params)}>Request a new confirmation link</Link></Button>
            </div>
          ) : <Loader2 className="mx-auto h-7 w-7 animate-spin" />}
        </CardContent>
      </Card>
    </div>
  );
}
