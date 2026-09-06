import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { KeyRound, LogOut, Upload, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { logChange } from "@/lib/auditLog";
import { useAuth } from "@/hooks/useAuth";
import { SettingsSection, SaveButton } from "./SettingsSection";

interface ProfileDraft {
  full_name: string;
  avatar_url: string;
}

export default function ProfileSettingsTab() {
  const { user, role, signOut } = useAuth();
  const userId = user?.id ?? null;
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileDraft | null>(null);
  const [original, setOriginal] = useState<ProfileDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
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
            <p className="text-xs text-muted-foreground">Sign-in email can't be changed here.</p>
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
