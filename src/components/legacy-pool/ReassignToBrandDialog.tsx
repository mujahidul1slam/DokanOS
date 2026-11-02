import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { ReassignTarget, SourceLite } from "@/lib/legacyPool";

export interface ReassignBrandOption {
  id: string;
  name: string;
  woo_store_id: string | null;
}

interface ReassignToBrandDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Human label of the row being moved, e.g. "Order #3000" or "Rahim Uddin". */
  itemLabel: string;
  brands: ReassignBrandOption[];
  sourcesByBrand: Record<string, SourceLite[]>;
  onConfirm: (target: ReassignTarget) => Promise<void> | void;
}

/**
 * Task 15: pick the brand (and one of its order sources — spec §7 files a pool
 * row under the brand's source) a legacy-pool row is reassigned to. Brands
 * with no order source cannot receive rows yet; the confirm stays disabled
 * with a pointer to the Order Sources page.
 */
export default function ReassignToBrandDialog({
  open,
  onOpenChange,
  itemLabel,
  brands,
  sourcesByBrand,
  onConfirm,
}: ReassignToBrandDialogProps) {
  const [brandId, setBrandId] = useState<string>("");
  const [sourceId, setSourceId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sensible defaults: first brand, first of its sources. Reset per open.
  useEffect(() => {
    if (!open) return;
    const firstBrand = brands[0];
    setBrandId(firstBrand?.id ?? "");
    setSourceId(firstBrand ? (sourcesByBrand[firstBrand.id]?.[0]?.id ?? "") : "");
    setError(null);
    setSaving(false);
  }, [open, brands, sourcesByBrand]);

  const sources = brandId ? (sourcesByBrand[brandId] ?? []) : [];
  const brand = brands.find((b) => b.id === brandId);
  const source = sources.find((s) => s.id === sourceId);

  const confirm = async () => {
    if (!brand || !source || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onConfirm({ brand, source });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reassignment failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reassign to a brand</DialogTitle>
          <DialogDescription>
            Move {itemLabel} out of the legacy pool and file it under a brand.
            Its provenance stays <span className="font-medium">legacy</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="reassign-brand">Brand</Label>
            <Select
              value={brandId}
              onValueChange={(value) => {
                setBrandId(value);
                setSourceId(sourcesByBrand[value]?.[0]?.id ?? "");
              }}
            >
              <SelectTrigger id="reassign-brand">
                <SelectValue placeholder="Choose a brand" />
              </SelectTrigger>
              <SelectContent>
                {brands.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="reassign-source">Order source</Label>
            <Select value={sourceId} onValueChange={setSourceId}>
              <SelectTrigger id="reassign-source">
                <SelectValue placeholder="Choose an order source" />
              </SelectTrigger>
              <SelectContent>
                {sources.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {brandId && sources.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {brand?.name ?? "This brand"} has no order source yet — create
                one on the Order Sources page first.
              </p>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={!brand || !source || saving}>
            {saving ? "Reassigning…" : "Reassign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
