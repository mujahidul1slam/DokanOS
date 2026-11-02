import { useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Warehouse } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { WarehouseRow } from "@/lib/stockHolders";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WarehouseDialog } from "@/components/warehouses/WarehouseDialog";
import type { OnboardingStepProps } from "../stepProps";
import { StepFooter } from "./StepFooter";

/**
 * Wizard step 4 (spec §6a: "Warehouses — add one or more (brand level)").
 * Creates real brand-level warehouses via the same dialog the Warehouses
 * settings tab uses; stock rows are added later (stock transfers / imports).
 */
export function WarehousesStep({ brands, onFinished, onBack, onGoToStep }: OnboardingStepProps) {
  const [targetBrandId, setTargetBrandId] = useState<string>(brands[0]?.id ?? "");
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WarehouseRow | null>(null);

  useEffect(() => {
    setTargetBrandId((current) =>
      brands.some((b) => b.id === current) ? current : (brands[0]?.id ?? ""),
    );
  }, [brands]);

  const reload = async () => {
    if (!targetBrandId) return;
    setLoading(true);
    const { data } = await supabase
      .from("warehouses")
      .select("*")
      .eq("brand_id", targetBrandId)
      .order("is_default", { ascending: false })
      .order("name");
    setWarehouses((data ?? []) as WarehouseRow[]);
    setLoading(false);
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetBrandId]);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (row: WarehouseRow) => {
    setEditing(row);
    setDialogOpen(true);
  };

  const targetBrand = brands.find((b) => b.id === targetBrandId);

  if (brands.length === 0) {
    // Warehouses live under a brand — nothing implicit is created here.
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-border bg-muted/30 px-4 py-3">
          <p className="text-sm text-foreground">
            Warehouses live under a brand. Add your first brand, then add where your stock lives.
          </p>
        </div>
        <StepFooter onBack={onBack} onSkip={() => void onFinished("skipped")} busy={false}>
          <Button type="button" onClick={() => onGoToStep("first_brand")}>
            Add your first brand
          </Button>
        </StepFooter>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {brands.length > 1 && (
        <div className="space-y-1.5">
          <span className="text-sm font-medium leading-none">Brand</span>
          <Select value={targetBrandId} onValueChange={setTargetBrandId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a brand" />
            </SelectTrigger>
            <SelectContent>
              {brands.map((brand) => (
                <SelectItem key={brand.id} value={brand.id}>
                  {brand.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Stock-only locations{targetBrand ? ` for ${targetBrand.name}` : ""} — orders never come
          from here. You can add more anytime in Settings → Warehouses.
        </p>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={openCreate}>
          <Plus className="h-4 w-4" /> Add warehouse
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : warehouses.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
          <Warehouse className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm text-foreground">No warehouses yet.</p>
          <p className="text-xs text-muted-foreground">
            Add one now, or skip — stock can be added later.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {warehouses.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{row.name}</span>
                  {row.is_default && <Badge variant="secondary">Default</Badge>}
                </div>
                {row.city && (
                  <p className="truncate text-xs text-muted-foreground">{row.city}</p>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5"
                onClick={() => openEdit(row)}
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            </li>
          ))}
        </ul>
      )}

      <WarehouseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        brandId={targetBrandId}
        brandName={targetBrand?.name}
        warehouse={editing}
        onSaved={() => void reload()}
      />

      <StepFooter onBack={onBack} onSkip={() => void onFinished("skipped")} busy={false}>
        <Button type="button" onClick={() => void onFinished("completed")}>
          {warehouses.length > 0 ? "Continue" : "Continue without a warehouse"}
        </Button>
      </StepFooter>
    </div>
  );
}
