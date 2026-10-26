import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { TurnstileWidget, TurnstileWidgetRef } from "@/components/TurnstileWidget";
import { isDisposableEmail } from "@/lib/disposableDomains";
import { mapAuthError } from "@/lib/authErrors";
import { readEdgeFnError } from "@/lib/edgeFnError";
import { invitationPath } from "@/lib/invitationPath";
import { toast } from "sonner";
import { Loader2, Eye, EyeOff, Lock, Mail, User, ShieldAlert } from "lucide-react";
import dokanosLogo from "@/assets/dokanos-logo-stacked.png";

export default function Signup() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [agreedConsent, setAgreedConsent] = useState(false);

  const [loading, setLoading] = useState(false);
  const [signupConfig, setSignupConfig] = useState<"loading" | "open" | "closed" | "error">("loading");

  const turnstileRef = useRef<TurnstileWidgetRef>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  // Check if signup is open
  useEffect(() => {
    async function checkSignupStatus() {
      try {
        const { data, error } = await supabase.rpc("is_signup_open");
        setSignupConfig(error || typeof data !== "boolean" ? "error" : data ? "open" : "closed");
      } catch {
        setSignupConfig("error");
      }
    }
    checkSignupStatus();
  }, []);

  const getPasswordStrength = (pass: string) => {
    if (!pass) return { score: 0, text: "" };
    let score = 0;
    if (pass.length >= 10) score++;
    if (/[A-Z]/.test(pass)) score++;
    if (/[0-9]/.test(pass)) score++;
    if (/[^A-Za-z0-9]/.test(pass)) score++;

    if (score <= 1) return { score: 1, text: "Weak", color: "bg-red-500" };
    if (score <= 3) return { score: 2, text: "Medium", color: "bg-amber-500" };
    return { score: 3, text: "Strong", color: "bg-emerald-500" };
  };

  const strength = getPasswordStrength(password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!fullName.trim() || fullName.trim().length > 100) {
      toast.error("Your name must be between 1 and 100 characters");
      return;
    }

    if (!email.trim() || !email.includes("@")) {
      toast.error("Please enter a valid email address");
      return;
    }

    if (isDisposableEmail(email)) {
      toast.error("Disposable email addresses are not accepted. Please use a work or personal email.");
      return;
    }

    if (password.length < 10) {
      toast.error("Password must be at least 10 characters");
      return;
    }

    if (!agreedConsent) {
      toast.error("You must agree to the Terms of Service and Privacy Policy");
      return;
    }

    setLoading(true);

    try {
      const token = captchaToken || turnstileRef.current?.getToken() || undefined;

      // Record consent and enforce server-side signup controls, not business setup.
      const { error: eventErr, data: eventData } = await supabase.functions.invoke("signup-event", {
        body: {
          event: "signup_started",
          email: email.trim(),
          meta: {
            signup_intent: "personal",
            consent: true,
          },
          captchaToken: token,
        },
      });

      // The edge fn's success contract is { status: "ok" }; failures carry
      // { error: "CODE", message }. Never treat a successful anchor as an error.
      if (eventErr || (eventData && eventData.error)) {
        const fnBody = eventData?.error
          ? (eventData as { error?: string; message?: string })
          : await readEdgeFnError(eventErr);
        const errCode = fnBody?.error || "";
        const errMsg = fnBody?.message || "";
        if (errCode.includes("RATE_LIMITED")) {
          setLoading(false);
          navigate(invitationPath(`/check-email?email=${encodeURIComponent(email.trim())}&rate_limited=true`));
          return;
        }
        toast.error(errMsg || mapAuthError(fnBody || eventErr));
        turnstileRef.current?.reset();
        setLoading(false);
        return;
      }

      // 3. Register account with Supabase Auth
      const { error: signUpErr } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: `${window.location.origin}${invitationPath("/auth/confirm")}`,
          data: {
            signup_intent: "personal",
            full_name: fullName.trim(),
          },
        },
      });

      if (signUpErr) {
        toast.error(mapAuthError(signUpErr));
        turnstileRef.current?.reset();
        setLoading(false);
        return;
      }

      setLoading(false);
      // Proceed to confirmation waiting screen
      navigate(invitationPath(`/check-email?email=${encodeURIComponent(email.trim())}`));
    } catch (err: unknown) {
      setLoading(false);
      turnstileRef.current?.reset();
      toast.error(mapAuthError(err));
    }
  };

  if (signupConfig === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (signupConfig === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md text-center p-6 space-y-4">
          <ShieldAlert className="h-12 w-12 text-destructive mx-auto" />
          <CardTitle className="text-xl">Unable to check sign-up availability</CardTitle>
          <CardDescription>Please try again later or sign in to your existing account.</CardDescription>
          <Button asChild className="w-full"><Link to="/login">Go to Login</Link></Button>
        </Card>
      </div>
    );
  }

  if (signupConfig === "closed") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md text-center p-6 space-y-4">
          <ShieldAlert className="h-12 w-12 text-muted-foreground mx-auto" />
          <CardTitle className="text-xl">Sign Up Currently Closed</CardTitle>
          <CardDescription>
            New registrations are currently restricted. If you already have an account, please sign in.
          </CardDescription>
          <Button asChild className="w-full">
            <Link to="/login">Go to Login</Link>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 py-8">
      <Card className="w-full max-w-lg shadow-xl border-border/40">
        <CardHeader className="text-center space-y-2">
          <img src={dokanosLogo} alt="DokanOS" className="mx-auto h-24 w-auto object-contain" />
          <CardTitle className="text-2xl font-bold tracking-tight">Create your personal account</CardTitle>
          <CardDescription>
            Verify your email, then choose a business account. No business details needed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="fullName" className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-muted-foreground" /> Your Name
              </Label>
              <Input
                id="fullName"
                type="text"
                placeholder="e.g. Sarah Jenkins"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
                required
                maxLength={100}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email" className="flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5 text-muted-foreground" /> Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className={isDisposableEmail(email) ? "border-destructive focus-visible:ring-destructive" : ""}
              />
              {isDisposableEmail(email) && (
                <p className="text-xs text-destructive font-medium flex items-center gap-1 mt-1">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Temporary and disposable email addresses are not permitted.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 text-muted-foreground" /> Password
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Minimum 10 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={10}
                  className="pr-10"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {password.length > 0 && (
                <div className="space-y-1 pt-1">
                  <div className="flex h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                    <div
                      className={`h-full ${strength.color} transition-all duration-300`}
                      style={{ width: `${(strength.score / 3) * 100}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground flex justify-between">
                    <span>{password.length < 10 ? "At least 10 characters required" : "Length requirement met"}</span>
                    <span className="font-medium text-foreground">{strength.text}</span>
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-start space-x-2 pt-2">
              <Checkbox
                id="consent"
                checked={agreedConsent}
                onCheckedChange={(c) => setAgreedConsent(!!c)}
                className="mt-0.5"
              />
              <label
                htmlFor="consent"
                className="text-xs text-muted-foreground leading-normal cursor-pointer select-none"
              >
                I agree to the <span className="text-primary hover:underline">Terms of Service</span> and{" "}
                <span className="text-primary hover:underline">Privacy Policy</span>.
              </label>
            </div>

            {/* Cloudflare Turnstile verification */}
            <TurnstileWidget
              ref={turnstileRef}
              action="signup"
              onSuccess={(token) => setCaptchaToken(token)}
            />

            <Button type="submit" className="w-full text-base py-5" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create personal account
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex justify-center border-t border-border/30 pt-4">
          <p className="text-xs text-muted-foreground">
            Already have an account?{" "}
            <Link to={invitationPath("/login")} className="text-primary font-medium hover:underline">
              Sign In
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
