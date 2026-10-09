import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle2, Globe, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Step4StorefrontProps {
  /** The step-1 brand id — the selling point rides it. */
  brandId: string;
  /** The step-1 store id — becomes the selling point's woo_store_id. */
  storeId: string;
  /** The R4a-reserved placeholder storefront id — what publish_my_storefront flips. */
  storefrontId: string | null;
  /** The reserved slug, shown as the read-only URL preview. */
  slug: string;
  /** Called after a successful publish so the shell can refresh server state. */
  onPublished: () => void;
}

/**
 * Wizard step 4 (audit R4, optional): attach the dokanos_storefront selling
 * point to the R4a-reserved row and publish it via the existing
 * publish_my_storefront RPC — NO new storefront INSERT anywhere (the
 * R4a-reserved row is what publishes; critique-2 #4). The step is optional:
 * the shell's Finish action is available without publishing.
 */
export function Step4Storefront({
  brandId,
  storeId,
  storefrontId,
  slug,
  onPublished,
}: Step4StorefrontProps) {
  const { active } = useBusinessContext();
  const [domain, setDomain] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState(false);

  // Same app_config surface step 1 reads — display-only preview.
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

  const url = domain ? `${slug}.${domain}` : slug;

  const handlePublish = async () => {
    if (!active || !brandId || !storefrontId || publishing || published) return;
    setPublishing(true);
    setError(null);
    try {
      // The dokanos_storefront selling point carries the R4a placeholder id
      // and the store id — the RPC's 4-assertion chain (store→brand→
      // storefront→selling_point) is satisfied by construction on this row.
      const { error: insertError } = await supabase.from("selling_points").insert({
        business_id: active.id,
        brand_id: brandId,
        type: "dokanos_storefront",
        name: active.name,
        storefront_id: storefrontId,
        woo_store_id: storeId,
      });
      if (insertError) throw insertError;
      const { error: rpcError } = await supabase.rpc("publish_my_storefront", {
        p_storefront_id: storefrontId,
      });
      if (rpcError) throw rpcError;
      setPublished(true);
      toast.success("Storefront published", {
        description: `https://${url} is now live.`,
      });
      onPublished();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not publish your storefront.");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Globe className="h-5 w-5 text-primary" /> Your storefront
        </h2>
        <p className="text-sm text-muted-foreground">
          Publishing is optional — you can finish now and publish later from
          StoresHub.
        </p>
      </div>

      <div className="rounded-md border border-border bg-muted/40 p-3">
        <p className="flex items-center gap-2 text-sm">
          <Globe className="h-4 w-4 text-primary shrink-0" />
          <span className="truncate">
            https://<strong className="text-foreground break-all">{url}</strong>
          </span>
        </p>
      </div>

      {published ? (
        <p className="flex items-start gap-2 text-sm">
          <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-600 shrink-0" />
          <span>Your storefront is live.</span>
        </p>
      ) : (
        <Button
          type="button"
          onClick={handlePublish}
          disabled={publishing || !storefrontId}
          className="gap-1.5"
        >
          {publishing && <Loader2 className="h-4 w-4 animate-spin" />}
          Publish my storefront
        </Button>
      )}
      {!storefrontId && !published && (
        <p className="text-xs text-muted-foreground">
          The reserved storefront could not be located — you can publish later
          from StoresHub.
        </p>
      )}

      {error && (
        <p className="flex items-start gap-1.5 text-sm text-destructive" role="alert">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
