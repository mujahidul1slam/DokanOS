import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  COURIER_PROVIDERS,
  courierProviderInfo,
  type CourierServiceRow,
} from "@/lib/courierServices";
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
  businessId: string;
  /** Row to edit; null/undefined opens create mode. */
  service?: CourierServiceRow | null;
  onSaved: () => void;
}

/**
 * Create/edit one business-level courier service (spec §4). Credentials are
 * write-only: a saved secret is never echoed back, and leaving a field blank on
 * edit keeps the stored value.
 */
export function CourierServiceDialog({ open, onOpenChange, businessId, service, onSaved }: Props) {
  const editing = !!service;
  const [provider, setProvider] = useState("");
  const [name, setName] = useState("");
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({});
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const providerInfo = useMemo(() => (provider ? courierProviderInfo(provider) : undefined), [provider]);
  const fields = providerInfo?.fields ?? [];

  useEffect(() => {
    if (!open) return;
    setError(null);
    setProvider(service?.provider ?? "");
    setName(service?.name ?? "");
    setIsActive(service?.is_active ?? true);
    const credentials = service?.credentials ?? {};
    setCredentialValues(
      Object.fromEntries(
        (service ? courierProviderInfo(service.provider)?.fields ?? [] : []).map((f) => [
          f.key,
          // Secrets stay write-only.
          f.secret ? "" : typeof credentials[f.key] === "string" ? (credentials[f.key] as string) : "",
        ]),
      ),
    );
  }, [open, service]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !provider || name.trim().length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const previous = service?.credentials ?? {};
      const credentials: Record<string, string> = {};
      for (const field of fields) {
        const value = (credentialValues[field.key] ?? "").trim();
        const existing = previous[field.key];
        if (value) credentials[field.key] = value;
        else if (field.secret && typeof existing === "string" && existing) {
          credentials[field.key] = existing; // keep the saved secret
        } else if (!field.secret && typeof existing === "string" && existing) {
          credentials[field.key] = existing;
        }
      }
      const payload = { provider, name: name.trim(), credentials, is_active: isActive };
      const result = service
        ? await supabase.from("courier_services").update(payload).eq("id", service.id).select("id").single()
        : await supabase.from("courier_services").insert({ ...payload, business_id: businessId }).select("id").single();
      if (result.error) throw result.error;
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error && err.message.includes("courier_services_business_name_key")
          ? "This business already has a courier service with that name."
          : err instanceof Error
            ? err.message
            : "Could not save the courier service.",
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
            <DialogTitle>{editing ? "Edit courier service" : "New courier service"}</DialogTitle>
            <DialogDescription>
              One courier account for the whole business — shared across every brand at fulfillment time.
            </DialogDescription>
          </DialogHeader>

          {!editing && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium leading-none">Provider</legend>
              <div className="grid grid-cols-2 gap-2">
                {COURIER_PROVIDERS.map((info) => (
                  <label
                    key={info.code}
                    className={`flex cursor-pointer items-center gap-2 rounded-md border p-2.5 text-sm ${
                      provider === info.code ? "border-primary bg-secondary/50" : "border-border"
                    }`}
                  >
                    <input
                      type="radio"
                      name="courier-provider"
                      value={info.code}
                      checked={provider === info.code}
                      onChange={() => {
                        setProvider(info.code);
                        setCredentialValues({});
                      }}
                    />
                    {info.label}
                  </label>
                ))}
              </div>
              {providerInfo && !providerInfo.dispatchSupported && (
                <p className="text-xs text-muted-foreground">
                  Dispatch through {providerInfo.label} arrives with its adapter — the service
                  can be managed here now.
                </p>
              )}
            </fieldset>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="courier-service-name">Name</Label>
            <Input
              id="courier-service-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Main Pathao account"
              maxLength={100}
              autoFocus
            />
          </div>

          {fields.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium leading-none">Credentials</legend>
              {fields.map((field) => {
                const existing = (service?.credentials ?? {})[field.key];
                const saved = typeof existing === "string" && existing.length > 0;
                return (
                  <div key={field.key} className="space-y-1.5">
                    <Label htmlFor={`courier-${field.key}`}>{field.label}</Label>
                    <Input
                      id={`courier-${field.key}`}
                      type={field.secret ? "password" : "text"}
                      autoComplete="off"
                      value={credentialValues[field.key] ?? ""}
                      onChange={(event) =>
                        setCredentialValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                      }
                      placeholder={field.secret && saved ? "••••••  (saved — leave blank to keep)" : field.placeholder ?? ""}
                    />
                  </div>
                );
              })}
            </fieldset>
          )}

          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="courier-service-active" className="text-sm">Active</Label>
              <p className="text-xs text-muted-foreground">Inactive services are hidden from the dispatch flow.</p>
            </div>
            <Switch id="courier-service-active" checked={isActive} onCheckedChange={setIsActive} />
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
            <Button type="submit" disabled={saving || !provider || name.trim().length === 0}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {editing ? "Save changes" : "Create service"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
