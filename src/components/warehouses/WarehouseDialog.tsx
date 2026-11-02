import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { WarehouseRow } from "@/lib/stockHolders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  brandId: string;
  brandName?: string;
  /** Row to edit; null/undefined opens create mode. */
  warehouse?: WarehouseRow | null;
  onSaved: () => void;
}

/**
 * Create/edit one brand-level warehouse (spec §3 — stock-only locations).
 * Stock lives on `product_locations` rows pointing at the warehouse; the
 * location entity itself is only name + contact.
 */
export function WarehouseDialog({ open, onOpenChange, brandId, brandName, warehouse, onSaved }: Props) {
  const editing = !!warehouse;
  const [name, setName] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [zone, setZone] = useState("");
  const [area, setArea] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(warehouse?.name ?? "");
    setIsDefault(warehouse?.is_default ?? false);
    setAddress(warehouse?.address ?? "");
    setCity(warehouse?.city ?? "");
    setZone(warehouse?.zone ?? "");
    setArea(warehouse?.area ?? "");
    setPhone(warehouse?.phone ?? "");
  }, [open, warehouse]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || name.trim().length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        is_default: isDefault,
        address: address.trim() || null,
        city: city.trim() || null,
        zone: zone.trim() || null,
        area: area.trim() || null,
        phone: phone.trim() || null,
      };
      const result = warehouse
        ? await supabase.from("warehouses").update(payload).eq("id", warehouse.id).select("id").single()
        : await supabase.from("warehouses").insert({ ...payload, brand_id: brandId }).select("id").single();
      if (result.error) throw result.error;
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error && err.message.includes("warehouses_brand_name_key")
          ? "This brand already has a warehouse with that name."
          : err instanceof Error
            ? err.message
            : "Could not save the warehouse.",
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
            <DialogTitle>{editing ? "Edit warehouse" : "New warehouse"}</DialogTitle>
            <DialogDescription>
              Stock-only location{brandName ? ` for ${brandName}` : ""} — orders never come from here.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="warehouse-name">Name</Label>
            <Input
              id="warehouse-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Main Warehouse"
              maxLength={100}
              autoFocus
            />
          </div>

          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="warehouse-default" className="text-sm">Default warehouse</Label>
              <p className="text-xs text-muted-foreground">The first fallback for fulfillment draws.</p>
            </div>
            <Switch id="warehouse-default" checked={isDefault} onCheckedChange={setIsDefault} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="warehouse-address">Address</Label>
            <Input id="warehouse-address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Street address" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="warehouse-city">City</Label>
              <Input id="warehouse-city" value={city} onChange={(event) => setCity(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="warehouse-zone">Zone</Label>
              <Input id="warehouse-zone" value={zone} onChange={(event) => setZone(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="warehouse-area">Area</Label>
              <Input id="warehouse-area" value={area} onChange={(event) => setArea(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="warehouse-phone">Phone</Label>
              <Input id="warehouse-phone" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="01XXXXXXXXX" />
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || name.trim().length === 0}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {editing ? "Save changes" : "Create warehouse"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
