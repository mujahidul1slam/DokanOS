import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import {
  BRAND_STORE_TYPES,
  BrandStoreError,
  createBrandStore,
  type BrandStore,
  type BrandStoreType,
} from "@/lib/brandStores";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultBrandId?: string | null;
  onCreated?: (store: BrandStore) => void;
}

/**
 * Issue #12: only a name, one parent brand and an explicit physical/online
 * type. Addresses, integrations and storefronts are deliberately absent, and
 * an online store is never published here.
 */
export function CreateBrandStoreDialog({ open, onOpenChange, defaultBrandId, onCreated }: Props) {
  const { active, brands, refresh } = useBusinessContext();
  const [brandId, setBrandId] = useState("");
  const [name, setName] = useState("");
  const [storeType, setStoreType] = useState<BrandStoreType | "">("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setStoreType("");
    setError(null);
    setBrandId(defaultBrandId ?? (brands.length === 1 ? brands[0].id : ""));
  }, [open, defaultBrandId, brands]);

  if (!active) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !brandId || !storeType || name.trim().length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const store = await createBrandStore({ brandId, name, storeType });
      await refresh();
      onCreated?.(store);
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof BrandStoreError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not create the store.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New Store</DialogTitle>
            <DialogDescription>
              Only a name, one parent brand and the store type are required.
              Addresses, integrations and storefronts can be configured later.
            </DialogDescription>
          </DialogHeader>

          {brands.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
              Create a brand first. A store always belongs to exactly one brand.
            </p>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="store-name">Store name</Label>
                <Input
                  id="store-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Dhanmondi Outlet"
                  maxLength={100}
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="store-brand">Parent brand</Label>
                <select
                  id="store-brand"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={brandId}
                  onChange={(event) => setBrandId(event.target.value)}
                >
                  <option value="">Select one brand</option>
                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              </div>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium leading-none">Store type</legend>
                <div className="grid grid-cols-2 gap-2">
                  {BRAND_STORE_TYPES.map((type) => (
                    <label
                      key={type}
                      className={`flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm ${
                        storeType === type ? "border-primary bg-secondary/50" : "border-border"
                      }`}
                    >
                      <input
                        type="radio"
                        name="store-type"
                        value={type}
                        checked={storeType === type}
                        onChange={() => setStoreType(type)}
                      />
                      {type === "physical" ? "Physical store" : "Online store"}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Physical outlets and online shops are separate stores. There is no
                  combined type.
                </p>
                {storeType === "online" && (
                  <p className="text-xs text-muted-foreground">
                    The online store starts unpublished. No website or storefront is
                    created until you configure and publish one deliberately.
                  </p>
                )}
              </fieldset>
            </>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving || brands.length === 0 || !brandId || !storeType || name.trim().length === 0}
            >
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Create store
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
