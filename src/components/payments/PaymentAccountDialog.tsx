import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  PAYMENT_PROVIDERS,
  paymentProviderInfo,
  type PaymentAccountRow,
} from "@/lib/paymentAccounts";
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
  account?: PaymentAccountRow | null;
  onSaved: () => void;
}

/**
 * Create/edit one business-level payment account (spec §4). Credentials are
 * write-only: a saved secret is never echoed back, and leaving a field blank on
 * edit keeps the stored value.
 */
export function PaymentAccountDialog({ open, onOpenChange, businessId, account, onSaved }: Props) {
  const editing = !!account;
  const [provider, setProvider] = useState("");
  const [name, setName] = useState("");
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({});
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const providerInfo = useMemo(() => (provider ? paymentProviderInfo(provider) : undefined), [provider]);
  const fields = providerInfo?.fields ?? [];

  useEffect(() => {
    if (!open) return;
    setError(null);
    setProvider(account?.provider ?? "");
    setName(account?.name ?? "");
    setIsActive(account?.is_active ?? true);
    const credentials = account?.credentials ?? {};
    setCredentialValues(
      Object.fromEntries(
        (account ? paymentProviderInfo(account.provider)?.fields ?? [] : []).map((f) => [
          f.key,
          // Secrets stay write-only.
          f.secret ? "" : typeof credentials[f.key] === "string" ? (credentials[f.key] as string) : "",
        ]),
      ),
    );
  }, [open, account]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !provider || name.trim().length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const previous = account?.credentials ?? {};
      const credentials: Record<string, string> = {};
      for (const field of fields) {
        const value = (credentialValues[field.key] ?? "").trim();
        const existing = previous[field.key];
        if (value) credentials[field.key] = value;
        else if (typeof existing === "string" && existing) {
          credentials[field.key] = existing; // keep the saved value
        }
      }
      const payload = { provider, name: name.trim(), credentials, is_active: isActive };
      const result = account
        ? await supabase.from("payment_accounts").update(payload).eq("id", account.id).select("id").single()
        : await supabase.from("payment_accounts").insert({ ...payload, business_id: businessId }).select("id").single();
      if (result.error) throw result.error;
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error && err.message.includes("payment_accounts_business_name_key")
          ? "This business already has a payment account with that name."
          : err instanceof Error
            ? err.message
            : "Could not save the payment account.",
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
            <DialogTitle>{editing ? "Edit payment account" : "New payment account"}</DialogTitle>
            <DialogDescription>
              One payment account for the whole business — shared across every brand at checkout time.
            </DialogDescription>
          </DialogHeader>

          {!editing && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium leading-none">Provider</legend>
              <div className="grid grid-cols-2 gap-2">
                {PAYMENT_PROVIDERS.map((info) => (
                  <label
                    key={info.code}
                    className={`flex cursor-pointer items-center gap-2 rounded-md border p-2.5 text-sm ${
                      provider === info.code ? "border-primary bg-secondary/50" : "border-border"
                    }`}
                  >
                    <input
                      type="radio"
                      name="payment-provider"
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
            </fieldset>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="payment-account-name">Name</Label>
            <Input
              id="payment-account-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Main bKash account"
              maxLength={100}
              autoFocus
            />
          </div>

          {fields.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium leading-none">Credentials</legend>
              {fields.map((field) => {
                const existing = (account?.credentials ?? {})[field.key];
                const saved = typeof existing === "string" && existing.length > 0;
                return (
                  <div key={field.key} className="space-y-1.5">
                    <Label htmlFor={`payment-${field.key}`}>{field.label}</Label>
                    <Input
                      id={`payment-${field.key}`}
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
              <Label htmlFor="payment-account-active" className="text-sm">Active</Label>
              <p className="text-xs text-muted-foreground">Inactive accounts cannot be selected at checkout.</p>
            </div>
            <Switch id="payment-account-active" checked={isActive} onCheckedChange={setIsActive} />
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
              {editing ? "Save changes" : "Create account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
