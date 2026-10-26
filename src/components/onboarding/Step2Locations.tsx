import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertCircle, ArrowRight, CheckCircle2, Loader2, MapPin, Plus } from "lucide-react";

interface Step2LocationsProps {
  /** The step-1 brand id — inserts ride it under the member JWT policy. */
  brandId: string | null;
  /** Called when the user continues past this step (with or without inserts). */
  onAdvance: () => void;
}

const TYPE_OPTIONS = [
  { value: "warehouse", label: "Warehouse" },
  { value: "showroom", label: "Showroom" },
  { value: "store", label: "Store" },
  { value: "online", label: "Online (virtual)" },
] as const;

interface LocationForm {
  name: string;
  type: string;
  is_default: boolean;
}

const EMPTY_FORM: LocationForm = { name: "", type: "warehouse", is_default: false };

/**
 * Wizard step 2 (D-09): one-or-more locations/warehouse rows, inserted via
 * supabase.from("locations") with the active business_id and the step-1
 * brand_id, riding the existing is_business_member INSERT policy — no RPC,
 * no service role. "Skip for now" advances WITHOUT any insert (zero rows
 * written on skip). Mirrors the StoresHub LocationsPanel dialog fields.
 */
export function Step2Locations({ brandId, onAdvance }: Step2LocationsProps) {
  const { active } = useBusinessContext();
  const [form, setForm] = useState<LocationForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!active || !brandId || saving) return;
    const trimmed = form.name.trim();
    if (!trimmed) {
      setError("Location name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { error: insertError } = await supabase.from("locations").insert({
        business_id: active.id,
        brand_id: brandId,
        name: trimmed,
        type: form.type,
        is_default: form.is_default,
      });
      if (insertError) throw insertError;
      setAdded((rows) => [...rows, trimmed]);
      setForm(EMPTY_FORM);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the location.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <MapPin className="h-5 w-5 text-primary" /> Where do you sell?
        </h2>
        <p className="text-sm text-muted-foreground">
          Add a warehouse (stock source) or a showroom (selling place). You can
          also skip this and manage locations later from StoresHub.
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
          <Label htmlFor="locationName">Location name</Label>
          <Input
            id="locationName"
            placeholder="e.g. Main Warehouse"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            disabled={saving}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="locationType">Type</Label>
          <select
            id="locationType"
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

        <div className="flex items-center gap-2">
          <Checkbox
            id="locationDefault"
            checked={form.is_default}
            onCheckedChange={(checked) => setForm({ ...form, is_default: checked === true })}
            disabled={saving}
          />
          <Label htmlFor="locationDefault" className="text-sm font-normal">
            Set as default location
          </Label>
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
            <Plus className="h-4 w-4" /> Add location
          </Button>
          <Button type="button" variant="ghost" onClick={onAdvance} disabled={saving} className="gap-1.5">
            Skip for now <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
        {!brandId && (
          <p className="text-xs text-muted-foreground">
            Locations need your store's brand to load — skip for now if it hasn't
            appeared yet.
          </p>
        )}
      </form>
    </div>
  );
}
