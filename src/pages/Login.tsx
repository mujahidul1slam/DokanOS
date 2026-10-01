import { useState, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, ArrowLeft, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } from "@/components/ui/input-otp";
import { parseMfaError, challengeAndVerify } from "@/lib/mfa";
import { TurnstileWidget, TurnstileWidgetRef } from "@/components/TurnstileWidget";
import { mapAuthError } from "@/lib/authErrors";
import dokanosLogo from "@/assets/dokanos-logo-stacked.png";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [showPassword, setShowPassword] = useState(false);
  // W9: MFA challenge step (non-enrolled users see zero UI change)
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaLoading, setMfaLoading] = useState(false);
  const turnstileRef = useRef<TurnstileWidgetRef>(null);
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const token = turnstileRef.current?.getToken() || undefined;
    const { error } = await signIn(email, password, token);
    setLoading(false);
    if (error) {
      // W9: an MFA-enrolled user's password-only sign-in fails with mfa_required
      const mfa = parseMfaError(error);
      if (mfa.isMfa) {
        setMfaFactorId(mfa.factorId);
        setMfaCode("");
        return;
      }
      turnstileRef.current?.reset();
      toast.error(mapAuthError(error));
      return;
    }
    navigate("/");
  };

  const handleMfaVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaFactorId || mfaCode.length < 6) return;
    setMfaLoading(true);
    try {
      await challengeAndVerify(mfaFactorId, mfaCode);
      navigate("/");
    } catch (err: any) {
      const msg = err?.message ?? "";
      toast.error(
        msg.toLowerCase().includes("expired")
          ? "That code expired — try again"
          : msg.toLowerCase().includes("failed") || msg.toLowerCase().includes("invalid")
            ? "Invalid code — check your authenticator and retry"
            : msg || "Verification failed",
      );
    }
    setMfaLoading(false);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) { toast.error("Enter your email"); return; }
    setLoading(true);
    const token = turnstileRef.current?.getToken() || undefined;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
      captchaToken: token,
    });
    setLoading(false);
    if (error) {
      turnstileRef.current?.reset();
      toast.error(mapAuthError(error));
    } else {
      toast.success("Password reset link sent to your email");
      setMode("login");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <img src={dokanosLogo} alt="DokanOS" className="mx-auto mb-2 h-32 w-auto object-contain" />
          <CardDescription>
            {mode === "login" ? "Sign in to your account" : "Reset your password"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {mfaFactorId ? (
            /* W9: MFA challenge step — shown only after an mfa_required sign-in */
            <form onSubmit={handleMfaVerify} className="space-y-4">
              <div className="flex flex-col items-center gap-2 text-center">
                <ShieldCheck className="h-8 w-8 text-primary" />
                <CardDescription>Enter the 6-digit code from your authenticator app</CardDescription>
              </div>
              <div className="flex justify-center">
                <InputOTP maxLength={6} value={mfaCode} onChange={setMfaCode} disabled={mfaLoading}>
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                  </InputOTPGroup>
                  <InputOTPSeparator />
                  <InputOTPGroup>
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </div>
              <Button type="submit" className="w-full" disabled={mfaLoading || mfaCode.length < 6}>
                {mfaLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Verify Code
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full gap-2"
                onClick={() => { setMfaFactorId(null); setMfaCode(""); }}
              >
                <ArrowLeft className="h-4 w-4" /> Back to sign in
              </Button>
            </form>
          ) : mode === "login" ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <button type="button" onClick={() => setMode("forgot")} className="text-xs text-primary hover:underline">
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <TurnstileWidget ref={turnstileRef} action="login" />
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Sign In
              </Button>
              <div className="pt-2 text-center space-y-2">
                <p className="text-xs text-muted-foreground">
                  Don't have a business account?{" "}
                  <Link to="/signup" className="text-primary font-medium hover:underline">
                    Create account
                  </Link>
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Didn't receive a confirmation email?{" "}
                  <Link to="/check-email" className="text-muted-foreground hover:text-foreground underline">
                    Resend link
                  </Link>
                </p>
              </div>
            </form>
          ) : (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reset-email">Email</Label>
                <Input id="reset-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
              </div>
              <TurnstileWidget ref={turnstileRef} action="forgot" />
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Send Reset Link
              </Button>
              <Button type="button" variant="ghost" className="w-full gap-2" onClick={() => setMode("login")}>
                <ArrowLeft className="h-4 w-4" /> Back to login
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;

