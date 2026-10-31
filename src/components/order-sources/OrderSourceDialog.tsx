import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  ORDER_SOURCE_TYPES,
  isPhysicalSourceType,
  orderSourceConfigFields,
  orderSourceTypeInfo,
  type OrderSourceRow,
  type OrderSourceType,
} from "@/lib/orderSources";
import {
  buildStockHolders,
  normalizeFulfillmentPreference,
  type StockHolder,
} from "@/lib/stockHolders";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brandId: string;
  brandName?: string;
  /** Row to edit; null/undefined opens create mode. */
  source?: OrderSourceRow | null;
  onSaved: () => void;
}

const SYNC_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "none", label: "No automatic sync (staff-entered)" },
  { value: "import", label: "Import — pull orders/products in" },
  { value: "export", label: "Export — push catalog out" },
  { value: "two_way", label: "Two-way" },
];

/**
 * Create/edit one order source. Connection config and sync settings live ON
 * the source (spec §2) — there is no separate integration entity. Credential
 * fields are write-only: a saved secret is never echoed back, and leaving the
 * field blank on edit keeps the stored value.
 */
export function OrderSourceDialog({ open, onOpenChange, brandId, brandName, source, onSaved }: Props) {
  const editing = !!source;
  const [name, setName] = useState("");
  const [type, setType] = useState<OrderSourceType | "">("");
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [syncDirection, setSyncDirection] = useState("none");
  const [shipFromStore, setShipFromStore] = useState(false);
  const [holdsStock, setHoldsStock] = useState(false);
  const [prefList, setPrefList] = useState<Array<{ id: string; name: string; kind: string; checked: boolean }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const configFields = useMemo(() => orderSourceConfigFields(type || ""), [type]);
  const typeInfo = type ? orderSourceTypeInfo(type) : undefined;
  const syncRelevant = type === "woocommerce" || type === "storefront";

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (source) {
      setName(source.name);
      setType((source.type as OrderSourceType) || "");
      setSyncDirection(source.sync_direction ?? "none");
      setHoldsStock(source.is_stock_holding ?? isPhysicalSourceType(source.type));
      setShipFromStore(source.ship_from_store ?? false);
      // Secrets stay write-only; non-secret values prefill for editing.
      const secrets = new Set(orderSourceConfigFields(source.type).filter((f) => f.secret).map((f) => f.key));
      const config = source.config ?? {};
      setConfigValues(
        Object.fromEntries(
          orderSourceConfigFields(source.type).map((f) => [
            f.key,
            secrets.has(f.key) ? "" : typeof config[f.key] === "string" ? (config[f.key] as string) : "",
          ]),
        ),
      );
    } else {
      setName("");
      setType("");
      setSyncDirection("none");
      setConfigValues({});
      setHoldsStock(false);
      setShipFromStore(false);
    }

    // The fulfillment pool: the brand's stock holders, minus this source
    // (its own stock is the ship-from-store toggle).
    let cancelled = false;
    (async () => {
      const [whRes, srcRes] = await Promise.all([
        supabase.from("warehouses").select("id, brand_id, name, is_default").eq("brand_id", brandId),
        supabase
          .from("order_sources")
          .select("id, brand_id, name, type, is_stock_holding")
          .eq("brand_id", brandId),
      ]);
      if (cancelled) return;
      const holders: StockHolder[] = buildStockHolders(
        (whRes.data ?? []) as Array<{ id: string; brand_id: string; name: string; is_default: boolean }>,
        ((srcRes.data ?? []) as Array<{ id: string; brand_id: string; name: string; is_stock_holding: boolean | null }>).filter(
          (s) => s.id !== source?.id,
        ),
      );
      const preferred = normalizeFulfillmentPreference(source?.fulfillment_preference, holders);
      const ordered = [
        ...preferred.map((id) => holders.find((h) => h.id === id)).filter((h): h is StockHolder => !!h),
        ...holders.filter((h) => !preferred.includes(h.id)),
      ];
      setPrefList(
        ordered.map((h) => ({ id: h.id, name: h.name, kind: h.kind, checked: preferred.includes(h.id) })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [open, source, brandId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !type || name.trim().length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const fields = orderSourceConfigFields(type);
      const previous = source?.config ?? {};
      const config: Record<string, string> = {};
      for (const field of fields) {
        const value = (configValues[field.key] ?? "").trim();
        const existing = previous[field.key];
        if (value) config[field.key] = value;
        else if (field.secret && typeof existing === "string" && existing) {
          config[field.key] = existing; // keep the saved secret
        }
      }
      const payload = {
        name: name.trim(),
        type,
        config,
        sync_direction: syncRelevant && syncDirection !== "none" ? syncDirection : null,
        ship_from_store: shipFromStore,
        fulfillment_preference: prefList.filter((r) => r.checked).map((r) => r.id),
        // Stock-holding is a physical-source toggle (spec §3); digital sources
        // take the DB default and can never hold stock rows.
        ...(isPhysicalSourceType(type) ? { is_stock_holding: holdsStock } : {}),
      };
      const result = source
        ? await supabase.from("order_sources").update(payload).eq("id", source.id).select("id").single()
        : await supabase.from("order_sources").insert({ ...payload, brand_id: brandId }).select("id").single();
      if (result.error) throw result.error;
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error && err.message.includes("order_sources_brand_name_key")
          ? "This brand already has an order source with that name."
          : err instanceof Error
            ? err.message
            : "Could not save the order source.",
      );
    } finally {
      setSaving(false);
    }
  };

  const movePref = (index: number, delta: number) => {
    setPrefList((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit order source" : "New order source"}</DialogTitle>
            <DialogDescription>
              One source per real-world place or channel orders come from
              {brandName ? ` — for ${brandName}` : ""}.
            </DialogDescription>
          </DialogHeader>

          {!editing && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium leading-none">Source type</legend>
              <div className="grid grid-cols-2 gap-2">
                {ORDER_SOURCE_TYPES.map((info) => (
                  <label
                    key={info.value}
                    className={`flex cursor-pointer items-center gap-2 rounded-md border p-2.5 text-sm ${
                      type === info.value ? "border-primary bg-secondary/50" : "border-border"
                    }`}
                  >
                    <input
                      type="radio"
                      name="order-source-type"
                      value={info.value}
                      checked={type === info.value}
                      onChange={() => {
                        setType(info.value);
                        setHoldsStock(isPhysicalSourceType(info.value));
                      }}
                    />
                    {info.label}
                  </label>
                ))}
              </div>
              {typeInfo && <p className="text-xs text-muted-foreground">{typeInfo.hint}</p>}
            </fieldset>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="order-source-name">Name</Label>
            <Input
              id="order-source-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={type === "manual" ? "Phone Orders, Wholesale, Referral…" : "Source name"}
              maxLength={100}
              autoFocus
            />
          </div>

          {configFields.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium leading-none">Connection</legend>
              {configFields.map((field) => {
                const savedSecret = field.secret && typeof (source?.config ?? {})[field.key] === "string" && !!(source?.config ?? {})[field.key];
                return (
                  <div key={field.key} className="space-y-1.5">
                    <Label htmlFor={`order-source-${field.key}`}>{field.label}</Label>
                    <Input
                      id={`order-source-${field.key}`}
                      type={field.secret ? "password" : "text"}
                      autoComplete="off"
                      value={configValues[field.key] ?? ""}
                      onChange={(event) =>
                        setConfigValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                      }
                      placeholder={savedSecret ? "••••••  (saved — leave blank to keep)" : field.placeholder}
                    />
                  </div>
                );
              })}
            </fieldset>
          )}

          {syncRelevant && (
            <div className="space-y-1.5">
              <Label htmlFor="order-source-sync">Sync</Label>
              <Select value={syncDirection} onValueChange={setSyncDirection}>
                <SelectTrigger id="order-source-sync" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SYNC_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium leading-none">Fulfillment</legend>
            {isPhysicalSourceType(type) && (
              <div className="flex items-center justify-between rounded-md border border-border p-2.5">
                <div>
                  <Label htmlFor="order-source-holds-stock" className="text-sm">Holds stock</Label>
                  <p className="text-xs text-muted-foreground">Physical sources hold stock by default.</p>
                </div>
                <Switch id="order-source-holds-stock" checked={holdsStock} onCheckedChange={setHoldsStock} />
              </div>
            )}
            <div className="flex items-center justify-between rounded-md border border-border p-2.5">
              <div>
                <Label htmlFor="order-source-ship-from-store" className="text-sm">Ship from store</Label>
                <p className="text-xs text-muted-foreground">Fulfill orders from this source's own stock.</p>
              </div>
              <Switch id="order-source-ship-from-store" checked={shipFromStore} onCheckedChange={setShipFromStore} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Stock draw order</Label>
              <p className="text-[10px] text-muted-foreground">
                Checked holders are drawn from, top first. This source's own stock
                is controlled by the ship-from-store toggle.
              </p>
              {prefList.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No stock holders yet — add a warehouse or a stock-holding source
                  first.
                </p>
              ) : (
                prefList.map((row, index) => (
                  <div key={row.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={row.checked}
                      onChange={() =>
                        setPrefList((prev) =>
                          prev.map((r, i) => (i === index ? { ...r, checked: !r.checked } : r)),
                        )
                      }
                      aria-label={`Draw from ${row.name}`}
                    />
                    <span className="flex-1 text-sm">
                      {row.name}{" "}
                      <span className="text-[10px] text-muted-foreground">
                        ({row.kind === "warehouse" ? "warehouse" : "source"})
                      </span>
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      disabled={index === 0}
                      onClick={() => movePref(index, -1)}
                      aria-label={`Move ${row.name} up`}
                    >
                      <ArrowUp className="h-3 w-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      disabled={index === prefList.length - 1}
                      onClick={() => movePref(index, 1)}
                      aria-label={`Move ${row.name} down`}
                    >
                      <ArrowDown className="h-3 w-3" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </fieldset>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !type || name.trim().length === 0}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {editing ? "Save changes" : "Create source"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
