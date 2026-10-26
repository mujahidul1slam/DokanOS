import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, ArrowRight, CheckCircle2, Loader2, Plus, Store } from "lucide-react";

interface Step3SellingPointsProps {
  /** The step-1 brand id — inserts ride it under the member JWT policy. */
  brandId: string | null;
  /** Called when the user continues past this step (with or without inserts). */
  onAdvance: () => void;
}

/** Mirrors the StoresHub SellingPointsPanel dialog's type set (step 4 owns dokanos_storefront). */
const TYPE_OPTIONS = [
  { value: "showroom_pos", label: "Showroom POS" },
  { value: "woocommerce", label: "WooCommerce" },
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "marketplace", label: "Marketplace" },
  { value: "other", label: "Other" },
] as const;

interface SellingPointForm {
  name: string;
  type: string;
}

const EMPTY_FORM: SellingPointForm = { name: "", type: "showroom_pos" };

/**
 * Wizard step 3 (D-09): the owner adds selling points explicitly via
 * supabase.from("selling_points") — plain member-policy rows (Release-2
 * constraint 4), no RPC, no service role. Copy honors the D-09 rationale:
 * these options (POS/Woo/Facebook) don't fit a storefront-only merchant, so
 * the skip affordance is prominent and the copy points at the StoresHub
 * Connect CTAs as the later path. "Skip for now" advances without writing.
 */
export function Step3SellingPoints({ brandId, onAdvance }: Step3SellingPointsProps) {
  const { active } = useBusinessContext();
  const [form, setForm] = useState<SellingPointForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!active || !brandId || saving) return;
    const trimmed = form.name.trim();
    if (!trimmed) {
      setError("Selling point name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { error: insertError } = await supabase.from("selling_points").insert({
        business_id: active.id,
        brand_id: brandId,
        name: trimmed,
        type: form.type,
      });
      if (insertError) throw insertError;
      setAdded((rows) => [...rows, trimmed]);
      setForm(EMPTY_FORM);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the selling point.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Store className="h-5 w-5 text-primary" /> How do you sell?
        </h2>
        <p className="text-sm text-muted-foreground">
          Add the sales channels you use today — POS counters, WooCommerce,
          Facebook, TikTok and more. Storefront-only? Skip this — you can
          connect channels anytime from the Connect section in StoresHub.
        </p>
      </div>

      {added.length > 0 && (
        <div className="space-y-2">
          {added.map((name) => (
            <p
              key={name}
              className="flex items-center gap-2 text-sm rounded-md border border-border/60 px-3 py-2"
            >
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              {name}
            </p>
          ))}
        </div>
      )}

      <form onSubmit={handleAdd} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="spName">Selling point name</Label>
          <Input
            id="spName"
            placeholder="e.g. Dhanmondi Showroom POS"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            disabled={saving}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="spType">Type</Label>
          <select
            id="spType"
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            disabled={saving}
          >
            {TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <p className="flex items-start gap-1.5 text-sm text-destructive" role="alert">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            {error}
          </p>
        )}

        <div className="flex items-center gap-2">
          <Button
            type="submit"
            disabled={saving || !brandId || !form.name.trim()}
            className="gap-1.5"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            <Plus className="h-4 w-4" /> Add selling point
          </Button>
          <Button type="button" variant="ghost" onClick={onAdvance} disabled={saving} className="gap-1.5">
            Skip for now <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
        {!brandId && (
          <p className="text-xs text-muted-foreground">
            Channels need your store's brand to load — skip for now if it hasn't
            appeared yet.
          </p>
        )}
      </form>
    </div>
  );
}
