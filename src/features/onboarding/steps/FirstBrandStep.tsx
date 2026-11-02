import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OnboardingStepProps } from "../stepProps";
import { StepFooter } from "./StepFooter";

/**
 * Wizard step 2 (spec §6a: "first brand — explicit step: name it, optional
 * logo. No ghost/untitled brands"). The brand row is created ONLY by this
 * form's submit with an explicit name — skipping or leaving the step creates
 * nothing. The logo is optional and a failed logo upload never blocks the
 * step (the brand already exists; the logo can be added later in settings).
 */
export function FirstBrandStep({
  businessId,
  brands,
  onFinished,
  onBack,
  onContextRefresh,
}: OnboardingStepProps) {
  const [name, setName] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Object-URL housekeeping for the local logo preview.
  useEffect(() => {
    return () => {
      if (logoPreview) URL.revokeObjectURL(logoPreview);
    };
  }, [logoPreview]);

  const pickLogo = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logo must be under 2MB");
      return;
    }
    setLogoFile(file);
    setLogoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  };

  const clearLogo = () => {
    setLogoFile(null);
    setLogoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  };

  const uploadLogo = async (brandId: string, file: File): Promise<boolean> => {
    const ext = file.name.split(".").pop() || "png";
    const path = `brand-${brandId}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("invoice-assets").upload(path, file, { upsert: true });
    if (error) return false;
    const { data: urlData } = supabase.storage.from("invoice-assets").getPublicUrl(path);
    const { error: updateError } = await supabase
      .from("brands")
      .update({ logo_url: urlData.publicUrl })
      .eq("id", brandId);
    return !updateError;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("create_business_brand", {
      p_business_id: businessId,
      p_name: trimmed,
    });
    const brand = data as { id?: string } | null;
    if (error || !brand?.id) {
      setSaving(false);
      const message = error?.message ?? "";
      toast.error(
        message.includes("BRAND_NAME_EXISTS")
          ? "A brand with this name already exists. Choose another name."
          : "Could not create the brand. Please try again.",
      );
      return;
    }
    if (logoFile && !(await uploadLogo(brand.id, logoFile))) {
      // Non-blocking: the named brand exists; the logo stays optional.
      toast.error("Brand created, but the logo could not be uploaded. You can add it later in Brand Settings.");
    } else {
      toast.success(`Brand "${trimmed}" created`);
    }
    onContextRefresh();
    await onFinished("completed");
    setSaving(false);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {brands.length > 0 && (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
          <p className="text-xs text-muted-foreground">
            Already created:{" "}
            {brands.map((brand, i) => (
              <Badge key={brand.id} variant="secondary" className={i > 0 ? "ml-1" : ""}>
                {brand.name}
              </Badge>
            ))}
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="onboarding-brand-name">Brand name</Label>
        <Input
          id="onboarding-brand-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Apex"
          maxLength={100}
          required
          autoFocus
        />
        <p className="text-xs text-muted-foreground">
          The name your customers see. No brand is created until you name one here.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Brand logo (optional)</Label>
        <div className="flex items-center gap-4">
          {logoPreview ? (
            <div className="relative">
              <img
                src={logoPreview}
                alt="Brand logo preview"
                className="h-16 w-16 rounded-md border border-border object-contain bg-white p-1"
              />
              <button
                type="button"
                onClick={clearLogo}
                className="absolute -top-2 -right-2 rounded-full bg-destructive p-0.5 text-destructive-foreground"
                aria-label="Remove logo"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-md border-2 border-dashed border-border text-muted-foreground">
              <ImagePlus className="h-5 w-5" />
            </div>
          )}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={() => fileInputRef.current?.click()}
            >
              {logoFile ? "Change logo" : "Upload logo"}
            </Button>
            <p className="mt-1 text-xs text-muted-foreground">PNG or JPG, max 2MB</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={pickLogo}
          />
        </div>
      </div>

      <StepFooter
        onBack={onBack}
        onSkip={() => void onFinished("skipped")}
        busy={saving}
        extra={
          brands.length > 0 ? (
            <Button type="button" variant="ghost" disabled={saving} onClick={() => void onFinished("completed")}>
              Continue
            </Button>
          ) : undefined
        }
      >
        <Button type="submit" disabled={saving || name.trim().length === 0}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Create brand
        </Button>
      </StepFooter>
    </form>
  );
}
