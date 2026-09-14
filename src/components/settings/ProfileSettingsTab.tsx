import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { KeyRound, Loader2, LogOut, Mail, ShieldCheck, Upload, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { logChange } from "@/lib/auditLog";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useRegisterDirty } from "@/hooks/useSettingsDirty";
import { SettingsSection, SaveButton } from "./SettingsSection";

interface ProfileDraft {
  full_name: string;
  avatar_url: string;
}

export default function ProfileSettingsTab() {
  const { user, role, signOut, isAdmin } = useAuth();
  const { canAny } = usePermissions();
  const setDirty = useRegisterDirty();
  const userId = user?.id ?? null;
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileDraft | null>(null);
  const [original, setOriginal] = useState<ProfileDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  // W8: email change (re-auth → updateUser → double-opt-in per project config)
  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [changingEmail, setChangingEmail] = useState(false);
  // W9: TOTP 2FA (enroll → verify → AAL2; disable with re-auth → unenroll)
  const [aal, setAal] = useState<{ current: string | null; next: string | null } | null>(null);
  const [totpFactors, setTotpFactors] = useState<{ id: string; friendly_name?: string }[]>([]);
  const [enrolledFactor, setEnrolledFactor] = useState<{ factorId: string; secret: string } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [mfaPassword, setMfaPassword] = useState("");
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaBusy, setMfaBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      const p: ProfileDraft = {
        full_name: data?.full_name || "",
        avatar_url: data?.avatar_url || "",
      };
      setProfileId(data?.id ?? null);
      setProfile(p);
      setOriginal(p);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const update = (key: keyof ProfileDraft, value: string) => {
    setProfile((p) => (p ? { ...p, [key]: value } : p));
  };

  // W6: report unsaved edits to the settings tab-switch guard
  const isDirty = !!profile && !!original && JSON.stringify(profile) !== JSON.stringify(original);
  useEffect(() => {
    setDirty(isDirty);
    return () => setDirty(false);
  }, [isDirty, setDirty]);

  const handleAvatar = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Image must be under 2MB");
      return;
    }
    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `avatar-${user.id}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("invoice-assets").upload(path, file, { upsert: true });
    if (error) {
      toast.error("Upload failed");
      setUploading(false);
      return;
    }
    const { data: urlData } = supabase.storage.from("invoice-assets").getPublicUrl(path);
    update("avatar_url", urlData.publicUrl);
    setUploading(false);
    toast.success("Photo uploaded — remember to save");
  };

  const handleSave = async () => {
    if (!user || !profile) return;
    const next = {
      full_name: profile.full_name.trim() || null,
      avatar_url: profile.avatar_url || null,
    };
    setSaving(true);
    const { data, error } = profileId
      ? await supabase.from("profiles").update(next).eq("id", profileId).select("id").single()
      : await supabase.from("profiles").insert({ user_id: user.id, ...next }).select("id").single();
    setSaving(false);
    if (error || !data) {
      toast.error("Failed to save profile");
      return;
    }
    await logChange("profile", data.id, original, {
      full_name: next.full_name ?? "",
      avatar_url: next.avatar_url ?? "",
    });
    setProfileId(data.id);
    const saved: ProfileDraft = { full_name: next.full_name || "", avatar_url: next.avatar_url || "" };
    setOriginal(saved);
    setProfile(saved);
    toast.success("Profile saved");
  };

  const handleChangePassword = async () => {
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    setChangingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setChangingPassword(false);
    if (error) {
      toast.error(
        error.message.toLowerCase().includes("different")
          ? "New password must be different from the current one"
          : error.message,
      );
      return;
    }
    setNewPassword("");
    setConfirmPassword("");
    await logChange("profile", profileId ?? undefined, null, { password: "changed" }, undefined, { action: "password_change" });
    toast.success("Password updated");
  };

  // W8: email change — client-side re-auth (UX hardening, not a security
  // boundary; documented residual risk) → updateUser({ email }) → the project's
  // confirmation flow (both inboxes when "Secure email change" is ON).
  const maskEmail = (e: string) => {
    const [local, domain] = e.split("@");
    if (!domain) return "***";
    return `${local.slice(0, 1)}***@${domain}`;
  };

  // W9: load AAL + verified factors when the user signs in / changes
  const refreshMfa = async () => {
    if (!user) return;
    try {
      const mfa = await import("@/lib/mfa");
      const a = await mfa.getAal();
      setAal(a);
      if (a.next === "aal2") {
        const factors = await mfa.listVerifiedTotpFactors();
        setTotpFactors(factors.map((f) => ({ id: f.id, friendly_name: f.friendly_name })));
      } else {
        setTotpFactors([]);
      }
    } catch {
      // MFA API unavailable — leave the section inert
    }
  };

  useEffect(() => {
    if (user) void refreshMfa();
  }, [user?.id]);

  // W9: enroll a new TOTP factor (secret shown for manual entry — no QR lib)
  const handleEnrollTotp = async () => {
    setMfaBusy(true);
    setMfaError(null);
    try {
      const mfa = await import("@/lib/mfa");
      const enrolled = await mfa.enrollTotp("DokanOS");
      setEnrolledFactor({ factorId: enrolled.factorId, secret: enrolled.secret });
    } catch (err: any) {
      setMfaError(err?.message || "Enrollment failed");
    }
    setMfaBusy(false);
  };

  // W9: verify the code → factor becomes verified → AAL2 on next sign-in
  const handleVerifyTotp = async () => {
    if (!enrolledFactor || totpCode.length < 6) return;
    setMfaBusy(true);
    setMfaError(null);
    try {
      const mfa = await import("@/lib/mfa");
      await mfa.challengeAndVerify(enrolledFactor.factorId, totpCode);
      setEnrolledFactor(null);
      setTotpCode("");
      await refreshMfa();
      toast.success("Two-factor authentication enabled");
    } catch (err: any) {
      const msg = err?.message ?? "";
      setMfaError(
        msg.toLowerCase().includes("expired") ? "Code expired — try again"
        : "Invalid code — check your authenticator and retry",
      );
    }
    setMfaBusy(false);
  };

  // W9: disable 2FA — requires password re-auth (client-side hardening), then unenroll
  const handleDisableTotp = async () => {
    if (!user || !mfaPassword || totpFactors.length === 0) return;
    setMfaBusy(true);
    setMfaError(null);
    try {
      const { error: reauthErr } = await supabase.auth.signInWithPassword({
        email: user.email ?? "",
        password: mfaPassword,
      });
      if (reauthErr) {
        setMfaError("Current password is incorrect");
        setMfaBusy(false);
        return;
      }
      const mfa = await import("@/lib/mfa");
      for (const f of totpFactors) await mfa.unenrollFactor(f.id);
      setMfaPassword("");
      await refreshMfa();
      toast.success("Two-factor authentication disabled");
    } catch (err: any) {
      setMfaError(err?.message || "Failed to disable 2FA");
    }
    setMfaBusy(false);
  };

  // W9: the section is offered to platform admins or team.manage holders (small audience)
  const canManage2fa = !!user && (isAdmin || canAny(["team.manage"]));

  const handleChangeEmail = async () => {
    if (!user || !newEmail || !emailPassword) return;
    setEmailError(null);
    setChangingEmail(true);
    // Step 1: explicit re-auth. Wrong password → inline error under the field.
    const { error: reauthErr } = await supabase.auth.signInWithPassword({
      email: user.email ?? "",
      password: emailPassword,
    });
    if (reauthErr) {
      setChangingEmail(false);
      setEmailError("Current password is incorrect");
      return;
    }
    // Step 2: request the email change.
    const { error } = await supabase.auth.updateUser({ email: newEmail });
    setChangingEmail(false);
    if (error) {
      toast.error(error.message.toLowerCase().includes("already")
        ? "That email is already in use"
        : error.message);
      return;
    }
    setEmailPassword("");
    setNewEmail("");
    await logChange("profile_email", profileId ?? undefined, { email: maskEmail(user.email ?? "") }, { email: maskEmail(newEmail) });
    toast.success("Check both inboxes — confirm the link to finish changing your email");
  };

  if (!user) return null;

  const initials = (profile?.full_name || user.email || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  return (
    <div className="space-y-4">
      <SettingsSection
        title="My Profile"
        description="How you appear inside DokanOS — on team pages and audit entries."
        footer={<SaveButton saving={saving} onClick={handleSave} label="Save Profile" />}
      >
        {/* Photo */}
        <div className="space-y-2">
          <Label>Photo</Label>
          <div className="flex items-center gap-4">
            <div className="relative">
              <Avatar className="h-20 w-20 border border-border">
                {profile?.avatar_url ? <AvatarImage src={profile.avatar_url} alt="Profile photo" /> : null}
                <AvatarFallback className="text-lg font-medium">{initials || "?"}</AvatarFallback>
              </Avatar>
              {profile?.avatar_url && (
                <button
                  onClick={() => update("avatar_url", "")}
                  className="absolute -top-1 -right-1 rounded-full bg-destructive p-0.5 text-destructive-foreground"
                  aria-label="Remove photo"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <div>
              <Button variant="outline" size="sm" disabled={uploading} onClick={() => fileInputRef.current?.click()} className="gap-1.5">
                <Upload className="h-3.5 w-3.5" />
                {uploading ? "Uploading…" : "Upload Photo"}
              </Button>
              <p className="text-xs text-muted-foreground mt-1">PNG or JPG, max 2MB</p>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatar} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Full Name</Label>
            <Input
              value={profile?.full_name ?? ""}
              onChange={(e) => update("full_name", e.target.value)}
              placeholder="Your name"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input value={user.email ?? ""} disabled />
            <p className="text-xs text-muted-foreground">Change your sign-in email in the "Change Email" section below.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>Role:</span>
          {role ? (
            <Badge variant={role === "admin" ? "default" : "secondary"} className="capitalize">{role}</Badge>
          ) : (
            <span className="text-xs">No role assigned</span>
          )}
          {user.created_at && (
            <span className="text-xs">· Member since {new Date(user.created_at).toLocaleDateString()}</span>
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Change Password"
        description="Minimum 8 characters. You stay signed in on this device after changing it."
        icon={KeyRound}
        footer={
          <SaveButton
            saving={changingPassword}
            disabled={!newPassword || !confirmPassword}
            onClick={handleChangePassword}
            label="Update Password"
          />
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-password">New Password</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-password">Confirm New Password</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Change Email"
        description="Confirm your current password, then enter the new address. Both inboxes receive a confirmation link."
        icon={Mail}
        footer={
          <SaveButton
            saving={changingEmail}
            disabled={!newEmail || !emailPassword}
            onClick={handleChangeEmail}
            label="Update Email"
          />
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Current Email</Label>
            <Input value={user.email ?? ""} disabled />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-email">New Email</Label>
            <Input
              id="new-email"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="new@example.com"
              autoComplete="email"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email-password">Current Password</Label>
          <Input
            id="email-password"
            type="password"
            value={emailPassword}
            onChange={(e) => setEmailPassword(e.target.value)}
            autoComplete="current-password"
          />
          {emailError && (
            <p role="alert" className="text-xs text-destructive">{emailError}</p>
          )}
        </div>
      </SettingsSection>

      {canManage2fa && (
        <SettingsSection
          title="Two-Factor Authentication"
          description="Extra protection at sign-in: a 6-digit code from your authenticator app. Optional."
          icon={ShieldCheck}
        >
          {enrolledFactor ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>1. Add this secret to your authenticator app</Label>
                <Input value={enrolledFactor.secret} readOnly className="font-mono text-sm" />
                <p className="text-xs text-muted-foreground">Manual entry — paste the secret into Google Authenticator, Authy, or 1Password.</p>
              </div>
              <div className="space-y-1.5">
                <Label>2. Enter the 6-digit code to confirm</Label>
                <Input
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="123456"
                  inputMode="numeric"
                  className="w-40 font-mono"
                />
                {mfaError && <p role="alert" className="text-xs text-destructive">{mfaError}</p>}
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleVerifyTotp} disabled={mfaBusy || totpCode.length < 6}>
                    {mfaBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Confirm & Enable
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setEnrolledFactor(null); setTotpCode(""); setMfaError(null); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          ) : aal?.next === "aal2" ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Badge className="bg-success/20 text-success">Enabled</Badge>
                <span className="text-muted-foreground">
                  {totpFactors.length} factor{totpFactors.length === 1 ? "" : "s"} active. A code is required at sign-in.
                </span>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mfa-password">Current password (to disable)</Label>
                <Input
                  id="mfa-password"
                  type="password"
                  value={mfaPassword}
                  onChange={(e) => setMfaPassword(e.target.value)}
                  autoComplete="current-password"
                  className="max-w-xs"
                />
                {mfaError && <p role="alert" className="text-xs text-destructive">{mfaError}</p>}
                <Button size="sm" variant="destructive" onClick={handleDisableTotp} disabled={mfaBusy || !mfaPassword}>
                  {mfaBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Disable 2FA
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Not enabled. When enabled, signing in requires your password plus a rotating 6-digit code.
              </p>
              <Button size="sm" variant="outline" onClick={handleEnrollTotp} disabled={mfaBusy}>
                {mfaBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Enable 2FA
              </Button>
              {mfaError && <p role="alert" className="text-xs text-destructive">{mfaError}</p>}
            </div>
          )}
        </SettingsSection>
      )}

      <SettingsSection
        title="Session"
        description="Sign out of DokanOS on this device."
        icon={LogOut}
      >
        <Button variant="outline" onClick={() => signOut()} className="gap-1.5">
          <LogOut className="h-4 w-4" />
          Sign Out
        </Button>
      </SettingsSection>
    </div>
  );
}
