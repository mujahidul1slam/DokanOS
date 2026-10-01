import { useState, useEffect, useRef } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { TurnstileWidget, TurnstileWidgetRef } from "@/components/TurnstileWidget";
import { toast } from "sonner";
import { Mail, Clock, ArrowLeft, RefreshCw, AlertCircle, CheckCircle2 } from "lucide-react";
import dokanosLogo from "@/assets/dokanos-logo-stacked.png";

export default function CheckEmail() {
  const [searchParams] = useSearchParams();
  const email = searchParams.get("email") || "";
  const rateLimited = searchParams.get("rate_limited") === "true";

  const [cooldown, setCooldown] = useState(60);
  const [resending, setResending] = useState(false);
  const turnstileRef = useRef<TurnstileWidgetRef>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleResend = async () => {
    if (!email) {
      toast.error("Email address missing. Please start over.");
      return;
    }
    if (cooldown > 0) return;

    setResending(true);
    try {
      const token = captchaToken || turnstileRef.current?.getToken() || undefined;

      const { data, error } = await supabase.functions.invoke("auth-resend", {
        body: {
          email,
          captchaToken: token,
        },
      });

      setResending(false);
      setCooldown(60);
      turnstileRef.current?.reset();

      if (error) {
        toast.error("Could not resend email. Please try again later.");
        return;
      }

      toast.success(data?.message || "Confirmation link re-sent if account exists.");
    } catch (err: any) {
      setResending(false);
      turnstileRef.current?.reset();
      toast.error("Failed to resend confirmation email.");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md shadow-xl border-border/40 text-center">
        <CardHeader className="space-y-3 pb-2">
          <img src={dokanosLogo} alt="DokanOS" className="mx-auto h-20 w-auto object-contain" />

          {rateLimited ? (
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10 text-amber-500">
              <AlertCircle className="h-7 w-7" />
            </div>
          ) : (
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Mail className="h-7 w-7" />
            </div>
          )}

          <CardTitle className="text-2xl font-bold tracking-tight">
            {rateLimited ? "Too many attempts today" : "Check your email"}
          </CardTitle>
          <CardDescription className="text-sm">
            {rateLimited ? (
              "To protect your security, daily signup attempts are capped. Please check your inbox for any existing confirmation email or try again tomorrow."
            ) : (
              <>
                We sent a confirmation link to <strong className="text-foreground">{email || "your email address"}</strong>. Click the link to verify your account and launch your store.
              </>
            )}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4 pt-2">
          {!rateLimited && (
            <div className="bg-muted/40 p-4 rounded-lg border border-border/30 text-xs text-muted-foreground text-left space-y-1.5">
              <div className="flex items-center gap-1.5 font-medium text-foreground">
                <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> What happens next?
              </div>
              <p>1. Open your email inbox and click the confirmation link.</p>
              <p>2. We will automatically provision your business, default location, catalog, and storefront.</p>
              <p>3. You'll enter your dashboard ready to sell!</p>
            </div>
          )}

          {!rateLimited && (
            <div className="pt-2">
              <TurnstileWidget
                ref={turnstileRef}
                action="resend"
                onSuccess={(token) => setCaptchaToken(token)}
              />
              <Button
                variant="outline"
                className="w-full gap-2 text-sm"
                disabled={resending || cooldown > 0}
                onClick={handleResend}
              >
                {resending ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : cooldown > 0 ? (
                  <>
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    Resend available in {cooldown}s
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    Resend confirmation email
                  </>
                )}
              </Button>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex flex-col gap-2 border-t border-border/30 pt-4">
          <Button variant="ghost" asChild className="w-full gap-1 text-xs">
            <Link to="/login">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
            </Link>
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Typed the wrong email?{" "}
            <Link to="/signup" className="text-primary hover:underline font-medium">
              Start over
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
