import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  ORDER_SOURCE_TYPES,
  orderSourceConfigFields,
  orderSourceTypeInfo,
  type OrderSourceRow,
  type OrderSourceType,
} from "@/lib/orderSources";
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
    }
  }, [open, source]);

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
                      onChange={() => setType(info.value)}
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
