import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import {
  createMyBrandStore,
  CreateMyBrandStoreError,
  type CreateMyBrandStoreResult,
} from "@/lib/createMyBrandStore";
import { generateStoreSlug } from "@/lib/slug";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, ArrowRight, CheckCircle2, Loader2, Store } from "lucide-react";

interface Step1StoreProps {
  /** Called when the user continues past a successful reservation. */
  onComplete: (result: CreateMyBrandStoreResult) => void;
}

/**
 * Wizard step 1 (D-11): the store name is pre-filled from the active
 * business, the storefront URL is a READ-ONLY reservation preview derived
 * live from the typed name (never editable, never "published"), and submit
 * reserves it via the create_my_brand_store RPC under the caller's own JWT.
 * After success the ACTUAL reserved slug from the RPC return is shown,
 * superseding the preview (the server derivation is authoritative).
 */
export function Step1Store({ onComplete }: Step1StoreProps) {
  const { active } = useBusinessContext();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reserved, setReserved] = useState<CreateMyBrandStoreResult | null>(null);
  const nameInitialized = useRef(false);

  // Pre-fill once from the active business name (it loads after mount).
  useEffect(() => {
    if (active && !nameInitialized.current) {
      nameInitialized.current = true;
      setName(active.name);
    }
  }, [active]);

  // The storefront domain comes from the same app_config surface the server
  // RPC reads; without it the RPC itself would fail, so this is display-only.
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("app_config")
      .select("value")
      .eq("key", "storefront_domain")
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const value = data?.value;
        setDomain(typeof value === "string" && value !== "" ? value : null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const previewSlug = generateStoreSlug(name || "");
  const previewUrl = domain ? `${previewSlug}.${domain}` : previewSlug;
  const reservedUrl = reserved ? (domain ? `${reserved.slug}.${domain}` : reserved.slug) : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!active || submitting || reserved) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 100) {
      setError("Store name must be between 1 and 100 characters.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await createMyBrandStore(active.id, trimmed);
      setReserved(result);
    } catch (err) {
      if (err instanceof CreateMyBrandStoreError || err instanceof Error) {
        setError(err.message);
      } else {
        setError("Something went wrong while reserving your storefront.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Store className="h-5 w-5 text-primary" /> Name your store
        </h2>
        <p className="text-sm text-muted-foreground">
          This creates your first store, brand and a reserved storefront — nothing
          goes live until you publish in the final step.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="storeName">Store name</Label>
          <Input
            id="storeName"
            placeholder="e.g. Apex Sportswear"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
            disabled={submitting || !!reserved}
            autoFocus
          />
          {error && (
            <p className="flex items-start gap-1.5 text-sm text-destructive" role="alert">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              {error}
            </p>
          )}
        </div>

        {reserved && reservedUrl ? (
          <div className="rounded-md border border-border bg-muted/40 p-3 space-y-3">
            <p className="flex items-start gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-600 shrink-0" />
              <span>
                Storefront reserved:{" "}
                <strong className="text-foreground break-all">https://{reservedUrl}</strong>{" "}
                — saved just for you.
              </span>
            </p>
            <Button type="button" onClick={() => onComplete(reserved)} className="gap-1.5">
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 p-2 rounded border border-border/30">
            <Store className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="truncate">
              https://<strong className="text-foreground">{previewUrl}</strong> — reserved
              for you
            </span>
          </div>
        )}

        {!reserved && (
          <Button type="submit" disabled={submitting || !active} className="gap-1.5">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Reserve my storefront
          </Button>
        )}
      </form>
    </div>
  );
}
