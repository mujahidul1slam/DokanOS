import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import dokanosLogo from "@/assets/dokanos-logo-stacked.png";
import { invitationPath } from "@/lib/invitationPath";
import { initialAuthCallbackType } from "@/lib/authCallbackIntent";
import { POST_LOGIN_STATE } from "@/lib/accounts/landing";
import { isProfileSetupOwed } from "@/lib/accounts/profileSetup";
import {
  resolveAuthConfirm,
  type AuthConfirmDeps,
} from "@/lib/accounts/authConfirmFlow";

/** Adapts the supabase client to the flow's deps (unit-tested with fakes). */
const authConfirmDeps: AuthConfirmDeps = {
  verifyOtp: async ({ type, token_hash }) => {
    const { data, error } = await supabase.auth.verifyOtp({
      type: type as EmailOtpType,
      token_hash,
    });
    return { user: data?.user ?? null, error };
  },
  getSession: async () => {
    const { data, error } = await supabase.auth.getSession();
    return { user: data?.session?.user ?? null, error };
  },
  getUser: async () => {
    const { data, error } = await supabase.auth.getUser();
    return { user: data?.user ?? null, error };
  },
  isProfileSetupOwed: (userId) => isProfileSetupOwed(supabase, userId),
  settle: () => new Promise((resolve) => setTimeout(resolve, 1200)),
};

/** Authentication callbacks never create business resources or accept invitations. */
export default function AuthConfirm() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const outcome = await resolveAuthConfirm(authConfirmDeps, {
        search: params,
        hash: new URLSearchParams(window.location.hash.slice(1)),
        initialType: initialAuthCallbackType,
      });
      if (!active) return;
      if (outcome.kind === "message") {
        setMessage(outcome.message);
        return;
      }
      if (outcome.kind === "reset-password") {
        navigate(invitationPath("/reset-password", params), { replace: true });
        return;
      }
      // Task 3: the one-time profile setup comes after verification and before
      // the business flow (the flow is fail-soft on the profiles read).
      if (outcome.kind === "profile-setup") {
        navigate(invitationPath("/profile/setup", params), { replace: true });
        return;
      }
      navigate(invitationPath("/accounts", params), { replace: true, state: POST_LOGIN_STATE });
    })();
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
