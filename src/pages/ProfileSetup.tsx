import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { invitationPath } from "@/lib/invitationPath";
import {
  normalizeProfilePhone,
  validateAvatarFile,
} from "@/lib/accounts/profileSetup";

/**
 * One-time "Set up your profile" step after email verification (spec §5/§6b).
 * Photo, name, and phone are all optional. Skip and Save both mark the step done
 * and continue to the business flow, keeping any invitation token.
 */
export default function ProfileSetup() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState("");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url, phone")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      setProfileId(data?.id ?? null);
      setFullName(data?.full_name || "");
      setAvatarUrl(data?.avatar_url || "");
      setPhone(data?.phone || "");
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // The business flow keeps the invitation token, so a pending invitation is never dropped.
  const continueToBusinesses = () => navigate(invitationPath("/accounts"), { replace: true });

  const handleAvatar = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    const problem = validateAvatarFile(file);
    if (problem) {
      toast.error(problem);
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
    setAvatarUrl(urlData.publicUrl);
    setUploading(false);
  };

  /**
   * Writes the given profile fields and stamps the one-time step as done. Skip
   * passes no fields at all, so it stamps completion and changes nothing else.
   */
  const persist = async (fields: Partial<{ full_name: string | null; phone: string | null; avatar_url: string | null }>) => {
    if (!user) return false;
    const completed = new Date().toISOString();
    const row = { ...fields, profile_setup_completed_at: completed };
    const { data, error } = profileId
      ? await supabase.from("profiles").update(row).eq("id", profileId).select("id").single()
      : await supabase.from("profiles").insert({ user_id: user.id, ...row }).select("id").single();
    if (error || !data) return false;
    setProfileId(data.id);
    return true;
  };

  const handleSave = async () => {
    let normalizedPhone: string | null;
    try {
      normalizedPhone = normalizeProfilePhone(phone);
    } catch (err) {
      setPhoneError(err instanceof Error ? err.message : "Enter a valid phone number");
      return;
    }
    setPhoneError(null);
    setSaving(true);
    const ok = await persist({
      full_name: fullName.trim() || null,
      phone: normalizedPhone,
      avatar_url: avatarUrl || null,
    });
    setSaving(false);
    if (!ok) {
      toast.error("Could not save your profile. Please try again.");
      return;
    }
    toast.success("Profile saved");
    continueToBusinesses();
  };

  const handleSkip = async () => {
    setSaving(true);
    // Skip stamps the step as done without changing any profile field.
    const ok = await persist({});
    setSaving(false);
    if (!ok) {
      toast.error("Could not continue. Please try again.");
      return;
    }
    continueToBusinesses();
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-7 w-7 animate-spin" />
      </div>
    );
  }

  const initials = (fullName || user?.email || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Set up your profile</CardTitle>
          <CardDescription>
            Add a photo, your name, and a phone number. Everything here is optional and you can change it later in settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16 border border-border">
              {avatarUrl ? <AvatarImage src={avatarUrl} alt="Profile photo" /> : null}
              <AvatarFallback className="text-base font-medium">{initials || "?"}</AvatarFallback>
            </Avatar>
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading || saving}
                onClick={() => fileInputRef.current?.click()}
                className="gap-1.5"
              >
                <Upload className="h-3.5 w-3.5" />
                {uploading ? "Uploading…" : "Upload photo"}
              </Button>
              <p className="mt-1 text-xs text-muted-foreground">PNG or JPG, max 2MB</p>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatar} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="setup-name">Full name</Label>
            <Input
              id="setup-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your name"
              autoComplete="name"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="setup-phone">Phone</Label>
            <Input
              id="setup-phone"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setPhoneError(null);
              }}
              placeholder="01XXXXXXXXX"
              autoComplete="tel"
              aria-invalid={phoneError ? true : undefined}
              aria-describedby={phoneError ? "setup-phone-error" : undefined}
            />
            {phoneError && (
              <p id="setup-phone-error" role="alert" className="text-xs text-destructive">
                {phoneError}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={handleSkip} disabled={saving || uploading}>
              Skip for now
            </Button>
            <Button type="button" onClick={handleSave} disabled={saving || uploading}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save and continue
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
