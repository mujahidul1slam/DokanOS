import { useEffect, useState, useRef } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { TurnstileWidget, TurnstileWidgetRef } from "@/components/TurnstileWidget";
import { Loader2, CheckCircle, AlertTriangle, ArrowRight, ShieldCheck, Building2 } from "lucide-react";
import { toast } from "sonner";
import dokanosLogo from "@/assets/dokanos-logo-stacked.png";

type ConfirmState = "verifying" | "provisioning" | "reanchor" | "no_session" | "error";

export default function AuthConfirm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [state, setState] = useState<ConfirmState>("verifying");
  const [statusMessage, setStatusMessage] = useState("Verifying your email confirmation link...");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Re-anchor form state for cross-device or missing nonce
  const [reanchorBusinessName, setReanchorBusinessName] = useState(
    () => localStorage.getItem("dokanos_signup_business_name") || ""
  );
  const [agreedConsent, setAgreedConsent] = useState(false);
  const [submittingReanchor, setSubmittingReanchor] = useState(false);
  const turnstileRef = useRef<TurnstileWidgetRef>(null);

  useEffect(() => {
    let active = true;

    async function processConfirmation() {
      try {
        // 1. Check or wait for active session
        let { data: { session } } = await supabase.auth.getSession();

        if (!session) {
          // Wait briefly for auth state to hydrate from URL hash / code
          await new Promise((r) => setTimeout(r, 1200));
          const res = await supabase.auth.getSession();
          session = res.data.session;
        }

        if (!active) return;

        if (!session || !session.user) {
          setState("no_session");
          return;
        }

        const user = session.user;
        setStatusMessage("Email confirmed. Connecting to your account...");

        // 2. Report email_confirmed event
        try {
          await supabase.functions.invoke("signup-event", {
            body: { event: "email_confirmed" },
          });
        } catch (e) {
          console.warn("email_confirmed event reporting failed:", e);
        }

        // 3. Read client-persisted nonce
        const nonce = localStorage.getItem("dokanos_signup_nonce");

        if (!nonce) {
          // Cross-device or wiped storage: prompt user to re-anchor business name
          setState("reanchor");
          return;
        }

        // 4. Provision business
        setState("provisioning");
        setStatusMessage("Provisioning your store, catalog, and admin permissions...");

        const { data: provData, error: provErr } = await supabase.functions.invoke("signup-provision", {
          body: { nonce },
        });

        if (!active) return;

        if (provErr || !provData?.slug) {
          const errMsg = provErr?.message || "";
          if (errMsg.includes("PROVISION_NO_ANCHOR")) {
            setState("reanchor");
            return;
          }

          navigate(
            `/welcome/setup-failed?code=${encodeURIComponent(provErr?.name || "PROVISION_FAILED")}&message=${encodeURIComponent(errMsg)}`
          );
          return;
        }

        // Success! Clean up setup state and navigate to /welcome
        localStorage.removeItem("dokanos_signup_nonce");
        localStorage.removeItem("dokanos_signup_business_name");
        navigate(`/welcome?slug=${encodeURIComponent(provData.slug)}`);
      } catch (err: any) {
        if (!active) return;
        setState("error");
        setErrorMessage(err?.message || "Failed to process confirmation.");
      }
    }

    processConfirmation();

    return () => {
      active = false;
    };
  }, [navigate]);

  const handleReanchorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reanchorBusinessName.trim()) {
      toast.error("Please enter your business name");
      return;
    }
    if (!agreedConsent) {
      toast.error("Please agree to the Terms of Service and Privacy Policy");
      return;
    }

    setSubmittingReanchor(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !user.email) {
        toast.error("Session expired. Please sign in again.");
        navigate("/login");
        return;
      }

      const freshNonce = crypto.randomUUID();
      const captchaToken = turnstileRef.current?.getToken() || undefined;

      // Re-anchor signup_started
      const { error: anchorErr } = await supabase.functions.invoke("signup-event", {
        body: {
          event: "signup_started",
          email: user.email,
          meta: {
            business_name: reanchorBusinessName.trim(),
            nonce: freshNonce,
          },
          captchaToken,
        },
      });

      if (anchorErr) {
        toast.error(anchorErr.message || "Failed to confirm business details.");
        setSubmittingReanchor(false);
        return;
      }

      // Re-call provision
      const { data: provData, error: provErr } = await supabase.functions.invoke("signup-provision", {
        body: { nonce: freshNonce },
      });

      setSubmittingReanchor(false);

      if (provErr || !provData?.slug) {
        toast.error(provErr?.message || "Provisioning failed.");
        navigate(
          `/welcome/setup-failed?message=${encodeURIComponent(provErr?.message || "Provisioning failed")}`
        );
        return;
      }

      localStorage.removeItem("dokanos_signup_nonce");
      navigate(`/welcome?slug=${encodeURIComponent(provData.slug)}`);
    } catch (err: any) {
      setSubmittingReanchor(false);
      toast.error(err?.message || "An unexpected error occurred.");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md shadow-xl border-border/40 text-center">
        <CardHeader className="space-y-3 pb-2">
          <img src={dokanosLogo} alt="DokanOS" className="mx-auto h-20 w-auto object-contain" />

          {state === "verifying" || state === "provisioning" ? (
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Loader2 className="h-7 w-7 animate-spin" />
            </div>
          ) : state === "reanchor" ? (
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Building2 className="h-7 w-7" />
            </div>
          ) : (
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10 text-amber-500">
              <AlertTriangle className="h-7 w-7" />
            </div>
          )}

          <CardTitle className="text-xl font-bold tracking-tight">
            {state === "verifying"
              ? "Confirming your email"
              : state === "provisioning"
              ? "Setting up your store"
              : state === "reanchor"
              ? "Confirm your business name"
              : state === "no_session"
              ? "Sign in to finish setup"
              : "Something went wrong"}
          </CardTitle>

          <CardDescription className="text-sm">
            {state === "verifying" || state === "provisioning"
              ? statusMessage
              : state === "reanchor"
              ? "You confirmed your email from a new device or tab. Confirm your business name to complete your store setup."
              : state === "no_session"
              ? "We couldn't detect an active session. Please sign in to resume your store setup."
              : errorMessage || "An unexpected error occurred."}
          </CardDescription>
        </CardHeader>

        <CardContent className="pt-2">
          {state === "reanchor" ? (
            <form onSubmit={handleReanchorSubmit} className="space-y-4 text-left">
              <div className="space-y-1.5">
                <Label htmlFor="bizName">Business Name</Label>
                <Input
                  id="bizName"
                  value={reanchorBusinessName}
                  onChange={(e) => setReanchorBusinessName(e.target.value)}
                  placeholder="e.g. Crimson Leather"
                  required
                  maxLength={100}
                />
              </div>

              <div className="flex items-start space-x-2 pt-1">
                <Checkbox
                  id="reanchorConsent"
                  checked={agreedConsent}
                  onCheckedChange={(c) => setAgreedConsent(!!c)}
                  className="mt-0.5"
                />
                <label
                  htmlFor="reanchorConsent"
                  className="text-xs text-muted-foreground leading-normal cursor-pointer select-none"
                >
                  I re-affirm agreement to the Terms of Service and Privacy Policy.
                </label>
              </div>

              <TurnstileWidget ref={turnstileRef} action="reanchor" />

              <Button type="submit" className="w-full gap-2" disabled={submittingReanchor}>
                {submittingReanchor && <Loader2 className="h-4 w-4 animate-spin" />}
                Complete Setup & Enter Store
              </Button>
            </form>
          ) : state === "no_session" ? (
            <div className="space-y-3 pt-2">
              <Button asChild className="w-full gap-2">
                <Link to="/login">
                  Sign In to Continue <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          ) : state === "error" ? (
            <div className="space-y-3 pt-2">
              <Button asChild variant="outline" className="w-full">
                <Link to="/signup">Start Fresh Registration</Link>
              </Button>
            </div>
          ) : (
            <div className="flex justify-center py-4">
              <div className="space-y-2 text-xs text-muted-foreground">
                <p>Creating your business catalog...</p>
                <p>Setting up POS terminal...</p>
                <p>Configuring your online storefront...</p>
              </div>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex justify-center border-t border-border/30 pt-3">
          <p className="text-[11px] text-muted-foreground">
            Protected by DokanOS Security and Cloudflare Turnstile.
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
