import { useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { toast } from "sonner";
import { AlertCircle, RotateCcw, Trash2, ArrowLeft, Loader2, ShieldX } from "lucide-react";
import dokanosLogo from "@/assets/dokanos-logo-stacked.png";

export default function SetupFailed() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const code = searchParams.get("code") || "";
  const message = searchParams.get("message") || "An error occurred during account provisioning.";

  const [cleaning, setCleaning] = useState(false);

  const isExpired = code.includes("EXPIRED") || message.includes("PROVISION_EXPIRED");
  const isBlockedDomain = code.includes("BLOCKED_DOMAIN") || message.includes("PROVISION_BLOCKED_DOMAIN");
  const isNoAnchor = code.includes("NO_ANCHOR") || message.includes("PROVISION_NO_ANCHOR");

  const handleSelfDeleteAndRestart = async () => {
    setCleaning(true);
    try {
      // Call delete_unprovisioned_self RPC
      const { error: delErr } = await supabase.rpc("delete_unprovisioned_self");
      if (delErr) {
        console.warn("Self delete error:", delErr);
      }
      await supabase.auth.signOut();
      localStorage.removeItem("dokanos_signup_nonce");
      localStorage.removeItem("dokanos_signup_business_name");
      setCleaning(false);
      navigate("/signup");
    } catch (err: any) {
      setCleaning(false);
      await supabase.auth.signOut();
      navigate("/signup");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md shadow-xl border-border/40 text-center">
        <CardHeader className="space-y-3 pb-2">
          <img src={dokanosLogo} alt="DokanOS" className="mx-auto h-20 w-auto object-contain" />

          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            {isBlockedDomain ? <ShieldX className="h-7 w-7" /> : <AlertCircle className="h-7 w-7" />}
          </div>

          <CardTitle className="text-xl font-bold tracking-tight">
            {isExpired
              ? "Setup Window Expired"
              : isBlockedDomain
              ? "Unsupported Email Provider"
              : isNoAnchor
              ? "Missing Setup Anchor"
              : "Account Setup Incomplete"}
          </CardTitle>

          <CardDescription className="text-sm">
            {isExpired
              ? "Account confirmation links are valid for 24 hours. You can clear this uncompleted account and start fresh."
              : isBlockedDomain
              ? "Disposable email domains are not accepted for merchant accounts. Please use a work or personal email."
              : isNoAnchor
              ? "We couldn't verify the original signup record for this email. You can resume setup or start fresh."
              : message}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-3 pt-2">
          {isNoAnchor ? (
            <Button asChild className="w-full gap-2">
              <Link to="/auth/confirm">
                <RotateCcw className="h-4 w-4" /> Resume Setup
              </Link>
            </Button>
          ) : (
            <Button
              onClick={handleSelfDeleteAndRestart}
              disabled={cleaning}
              className="w-full gap-2"
            >
              {cleaning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              Clear and Start Fresh Sign Up
            </Button>
          )}

          <Button
            variant="outline"
            onClick={handleSelfDeleteAndRestart}
            disabled={cleaning}
            className="w-full gap-2 text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" /> Cancel & Delete This Registration
          </Button>
        </CardContent>

        <CardFooter className="flex justify-center border-t border-border/30 pt-3">
          <Button variant="ghost" asChild className="text-xs gap-1">
            <Link to="/login">
              <ArrowLeft className="h-3 w-3" /> Back to Sign In
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
