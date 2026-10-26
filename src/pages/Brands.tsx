import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import { canCreateBusinessResources } from "@/lib/accounts/rolePresentation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Building2, Loader2, Plus, Store, Tags } from "lucide-react";
import { CreateBrandStoreDialog } from "@/components/stores/CreateBrandStoreDialog";

/**
 * Issue #11: brand identities inside the active business account.
 *
 * A brand needs only a name. This page never creates a store, storefront, or
 * selling point, and an empty account/brand is a normal navigable state.
 */
export default function Brands() {
  const { active, brands, brandStores, loading, myRole, refresh } = useBusinessContext();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storeOpen, setStoreOpen] = useState(false);
  const [storeBrandId, setStoreBrandId] = useState<string | null>(null);

  const canCreate = canCreateBusinessResources(myRole);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!active) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-sm text-muted-foreground">No business account is selected.</p>
        <Button asChild variant="outline" className="mt-3">
          <Link to="/accounts">Choose a business account</Link>
        </Button>
      </div>
    );
  }

  const openDialog = () => {
    setName("");
    setError(null);
    setOpen(true);
  };

  const openStoreDialog = (brandId: string | null = null) => {
    setStoreBrandId(brandId);
    setStoreOpen(true);
  };

  const createBrand = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    setError(null);
    try {
      const { error: createError } = await supabase.rpc("create_business_brand", {
        p_business_id: active.id,
        p_name: trimmed,
      });
      if (createError) throw createError;
      await refresh();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the brand.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-secondary">
            <Building2 className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Business Account</p>
            <h1 className="font-heading text-xl font-semibold">Brands</h1>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="secondary">
              {`${brands.length} ${brands.length === 1 ? "brand" : "brands"} under ${active.name}`}
            </Badge>
            <Badge variant="outline">
              {`${brandStores.length} ${brandStores.length === 1 ? "store" : "stores"}`}
            </Badge>
            {canCreate && brands.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => openStoreDialog()}>
                <Store className="h-3.5 w-3.5 mr-1" /> New Store
              </Button>
            )}
            {canCreate && (
              <Button size="sm" onClick={openDialog}>
                <Plus className="h-3.5 w-3.5 mr-1" /> New Brand
              </Button>
            )}
          </div>
        </div>
      </div>

      {brands.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-10 text-center">
          <Tags className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="font-medium">No brands yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add a brand name to start organizing this business. Brands can exist
              without stores, and this does not start onboarding.
            </p>
          </div>
          {canCreate && (
            <Button size="sm" onClick={openDialog}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Create your first brand
            </Button>
          )}
          <Button asChild size="sm" variant="ghost">
            <Link to="/stores">View stores and operational setup</Link>
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {brands.map((brand) => {
            const storeCount = brandStores.filter((store) => store.brand_id === brand.id).length;
            return (
            <div key={brand.id} className="rounded-lg border border-border bg-card p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
                  <Tags className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-heading text-sm font-semibold">{brand.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {storeCount > 0
                      ? `${storeCount} ${storeCount === 1 ? "store" : "stores"}`
                      : brand.woo_store_id
                        ? "Legacy Woo store linked"
                        : "No stores yet"}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link to="/stores">
                    <Store className="h-3.5 w-3.5 mr-1" /> Stores
                  </Link>
                </Button>
                {canCreate && (
                  <Button size="sm" variant="ghost" onClick={() => openStoreDialog(brand.id)}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add store
                  </Button>
                )}
                <Badge variant={brand.is_active ? "secondary" : "outline"} className="text-[10px]">
                  {brand.is_active ? "Active" : "Inactive"}
                </Badge>
              </div>
            </div>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={(next) => !saving && setOpen(next)}>
        <DialogContent>
          <form onSubmit={createBrand} className="space-y-4">
            <DialogHeader>
              <DialogTitle>New Brand</DialogTitle>
              <DialogDescription>
                Only a name is required. A store, storefront, or onboarding step is not created.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="brand-name">Brand name</Label>
              <Input
                id="brand-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="North Star"
                maxLength={100}
                autoFocus
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || name.trim().length === 0}>
                {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Create brand
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <CreateBrandStoreDialog
        open={storeOpen}
        onOpenChange={setStoreOpen}
        defaultBrandId={storeBrandId}
      />
    </div>
  );
}
