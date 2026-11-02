import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import { useActiveBusinessStoreIds } from "@/hooks/useActiveBusinessStoreIds";
import { THEME_PRESETS } from "@/components/storefront-admin/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_STOREFRONT_SETUP,
  slugifyStorefrontName,
  validateStorefrontSetup,
  type StorefrontSetupValues,
} from "./storefrontSetup";
import { createStorefrontFromForm, type CreatedStorefront } from "./storefrontCreate";

/**
 * Task 14 (spec §6a step 6): the storefront sub-onboarding — ONE shared
 * creation flow ("name/slug, theme, payments, publish") used by both entry
 * points: the onboarding wizard's storefront step and the Storefronts area's
 * "create storefront" (CreateStorefrontDialog below). Nothing here is
 * duplicated anywhere else; later edits happen in the storefront admin tabs.
 */

interface StorefrontSubOnboardingProps {
  onCreated: (sf: CreatedStorefront) => void;
  submitLabel?: string;
  /** Secondary buttons rendered before the submit button (e.g. Skip / Cancel). */
  extraActions?: ReactNode;
}

/**
 * The shared sub-onboarding form: name/slug → theme → payments → publish.
 * Self-contained (reads the active business context); used inline by the
 * onboarding wizard's storefront step and inside CreateStorefrontDialog.
 */
export function StorefrontSubOnboarding({
  onCreated,
  submitLabel = "Create storefront",
  extraActions,
}: StorefrontSubOnboardingProps) {
  const { active, brands } = useBusinessContext();
  const businessStoreIds = useActiveBusinessStoreIds();
  const [values, setValues] = useState<StorefrontSetupValues>(DEFAULT_STOREFRONT_SETUP);
  const [brandChoice, setBrandChoice] = useState<string>("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  // Default to the business's first brand (never a ghost brand — spec §6a);
  // "__new" only when the business has none yet.
  useEffect(() => {
    setBrandChoice((current) =>
      current === "__new" || brands.some((b) => b.id === current)
        ? current
        : (brands[0]?.id ?? "__new"),
    );
  }, [brands]);

  const set = <K extends keyof StorefrontSetupValues>(key: K, value: StorefrontSetupValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const handleNameChange = (name: string) => {
    set("name", name);
    if (!slugTouched) set("slug", slugifyStorefrontName(name));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    const created = await createStorefrontFromForm({
      values,
      brandChoice,
      businessId: active?.id ?? "",
      business: active,
      brands,
      businessStoreIds,
    });
    setSaving(false);
    if (created) onCreated(created);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <section className="space-y-3 rounded-md border border-border p-4">
        <h3 className="text-sm font-medium">1 · Name &amp; URL</h3>
        <div className="space-y-1.5">
          <Label htmlFor="sf-setup-name">Storefront name</Label>
          <Input
            id="sf-setup-name"
            value={values.name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="e.g. My Brand"
            maxLength={100}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sf-setup-slug">URL slug</Label>
          <Input
            id="sf-setup-slug"
            value={values.slug}
            onChange={(e) => {
              setSlugTouched(true);
              set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
            }}
            placeholder="e.g. my-brand"
            maxLength={100}
            required
          />
          <p className="text-xs text-muted-foreground">
            Will be accessible at /storefront/{values.slug || "…"}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Brand</Label>
          <Select value={brandChoice} onValueChange={setBrandChoice}>
            <SelectTrigger>
              <SelectValue placeholder="Pick a brand…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__new">Create new brand (“{values.name || "name"}”)</SelectItem>
              {brands.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Every storefront belongs to a brand — pick an existing one or create a new one.
          </p>
        </div>
      </section>

      <section className="space-y-3 rounded-md border border-border p-4">
        <h3 className="text-sm font-medium">2 · Theme</h3>
        <Select value={values.theme} onValueChange={(v) => set("theme", v)}>
          <SelectTrigger id="sf-setup-theme">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {THEME_PRESETS.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                <div>
                  <div>{t.label}</div>
                  <div className="text-xs text-muted-foreground">{t.description}</div>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>

      <section className="space-y-3 rounded-md border border-border p-4">
        <h3 className="text-sm font-medium">3 · Payments</h3>
        <p className="text-xs text-muted-foreground">
          Choose how customers pay at checkout. More wallets (Rocket, Upay, mCash) and fine tuning
          live in the Payments tab.
        </p>
        <div className="space-y-2">
          {(
            [
              { key: "cod", label: "Cash on delivery" },
              { key: "bkash", label: "bKash" },
              { key: "nagad", label: "Nagad" },
            ] as const
          ).map((m) => (
            <div key={m.key} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <Label htmlFor={`sf-pay-${m.key}`} className="text-sm">
                {m.label}
              </Label>
              <Switch
                id={`sf-pay-${m.key}`}
                checked={values.methods[m.key]}
                onCheckedChange={(v) => set("methods", { ...values.methods, [m.key]: v })}
              />
            </div>
          ))}
        </div>
        {values.methods.cod && (
          <div className="space-y-1.5">
            <Label htmlFor="sf-cod-instructions">COD customer instructions</Label>
            <Input
              id="sf-cod-instructions"
              value={values.codInstructions}
              onChange={(e) => set("codInstructions", e.target.value)}
              placeholder="Shown to COD customers"
            />
          </div>
        )}
        {values.methods.bkash && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sf-bkash-number">bKash account number</Label>
              <Input
                id="sf-bkash-number"
                value={values.bkashNumber}
                onChange={(e) => set("bkashNumber", e.target.value)}
                placeholder="01XXXXXXXXX"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sf-bkash-instructions">bKash instructions</Label>
              <Input
                id="sf-bkash-instructions"
                value={values.bkashInstructions}
                onChange={(e) => set("bkashInstructions", e.target.value)}
                placeholder="Shown to bKash customers"
              />
            </div>
          </div>
        )}
        {values.methods.nagad && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sf-nagad-number">Nagad account number</Label>
              <Input
                id="sf-nagad-number"
                value={values.nagadNumber}
                onChange={(e) => set("nagadNumber", e.target.value)}
                placeholder="01XXXXXXXXX"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sf-nagad-instructions">Nagad instructions</Label>
              <Input
                id="sf-nagad-instructions"
                value={values.nagadInstructions}
                onChange={(e) => set("nagadInstructions", e.target.value)}
                placeholder="Shown to Nagad customers"
              />
            </div>
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-md border border-border p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium">4 · Publish</h3>
            <p className="text-xs text-muted-foreground">
              {values.publishNow
                ? "The storefront goes live at /storefront/" + (values.slug || "…") + " with its starter Home page published."
                : "Everything stays in draft — nothing is visible until you publish from the Pages tab."}
            </p>
          </div>
          <Switch
            id="sf-publish-now"
            checked={values.publishNow}
            onCheckedChange={(v) => set("publishNow", v)}
          />
        </div>
      </section>

      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-end">
        {extraActions}
        <Button type="submit" disabled={saving}>
          {saving ? "Creating…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

/**
 * The Storefronts-area entry point ("New Storefront" + the empty-state
 * auto-open) — the SAME sub-onboarding in a dialog wrapper (fix D kept:
 * onCreate reloads the list and opens the new storefront's admin).
 */
export function CreateStorefrontDialog({
  open,
  onOpenChange,
  onCreate,
  autoOpen,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (sf: CreatedStorefront) => void;
  /** Empty-state mode: the trigger button is hidden (page auto-opens the dialog). */
  autoOpen?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {!autoOpen && (
        <DialogTrigger asChild>
          <Button variant="default" size="sm" className="gap-2">
            <Plus className="h-4 w-4" /> New Storefront
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Create new storefront</DialogTitle>
          <DialogDescription>
            Launch a new native storefront under a brand — the same guided setup runs from
            onboarding too. Starter pages are created automatically.
          </DialogDescription>
        </DialogHeader>
        <StorefrontSubOnboarding
          submitLabel="Create"
          onCreated={(sf) => {
            onCreate(sf);
            onOpenChange(false);
          }}
          extraActions={
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          }
        />
      </DialogContent>
    </Dialog>
  );
}
