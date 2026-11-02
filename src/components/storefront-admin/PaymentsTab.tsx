import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Save, Loader2 } from "lucide-react";
import type { Storefront } from "./shared";
import { mergeSettings, type StorefrontPaymentsSettings, type StorefrontPaymentMethod } from "@/storefront/lib/settings";

type WalletKey = "bkash" | "nagad" | "rocket" | "upay" | "mcash";
const WALLETS: WalletKey[] = ["bkash", "nagad", "rocket", "upay", "mcash"];

function WalletEditor({
  label, value, onChange, enabled, onToggle,
}: {
  label: string;
  value: StorefrontPaymentMethod;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  onChange: (v: StorefrontPaymentMethod) => void;
}) {
  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-medium">{label}</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Active at checkout</span>
            <Switch checked={enabled} onCheckedChange={onToggle} />
          </div>
        </div>

        {enabled && (
          <>
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Payment type</Label>
                <Select value={value.type} onValueChange={(v) => onChange({ ...value, type: v as StorefrontPaymentMethod["type"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="send-money">Send Money</SelectItem>
                    <SelectItem value="payment">Payment</SelectItem>
                    <SelectItem value="cash-out">Cash Out</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Account name</Label>
                <Input value={value.account_name} onChange={(e) => onChange({ ...value, account_name: e.target.value })} placeholder="Enveil" />
              </div>
              <div>
                <Label className="text-xs">Account / wallet number</Label>
                <Input value={value.account_number} onChange={(e) => onChange({ ...value, account_number: e.target.value })} placeholder="01XXXXXXXXX" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Customer instructions</Label>
              <Input value={value.instructions} onChange={(e) => onChange({ ...value, instructions: e.target.value })} placeholder="Shown to customers at checkout who pick this method" />
            </div>
            <div className="flex items-center justify-between">
              <div className="pr-4">
                <Label className="text-sm">Ask for the customer's phone number</Label>
                <p className="text-xs text-muted-foreground mt-0.5">When on, checkout asks for the sender wallet number. Off = transaction ID only.</p>
              </div>
              <Switch checked={value.ask_for_phone} onCheckedChange={(v) => onChange({ ...value, ask_for_phone: v })} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function PaymentsTab({ sf, onUpdate }: { sf: Storefront; onUpdate: (s: Storefront) => void }) {
  const [draft, setDraft] = useState<{ methods: Record<string, boolean>; payments: StorefrontPaymentsSettings }>(() => {
    const m = mergeSettings((sf as any).settings);
    return { methods: { ...m.checkout.methods } as unknown as Record<string, boolean>, payments: m.payments };
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const m = mergeSettings((sf as any).settings);
    setDraft({ methods: { ...m.checkout.methods } as unknown as Record<string, boolean>, payments: m.payments });
  }, [sf]);

  function setWallet(k: WalletKey, v: StorefrontPaymentMethod) {
    setDraft({ ...draft, payments: { ...draft.payments, [k]: v } });
  }

  function setEnabled(k: WalletKey | "cod", v: boolean) {
    setDraft({ ...draft, methods: { ...draft.methods, [k]: v } });
  }

  async function save() {
    const enabledCount = Object.values(draft.methods).filter(Boolean).length;
    if (enabledCount === 0) return toast({ title: "At least one payment method must be enabled", variant: "destructive" });
    setSaving(true);
    const prev = mergeSettings((sf as any).settings);
    const settings = {
      ...prev,
      checkout: { ...prev.checkout, methods: draft.methods },
      payments: draft.payments,
    };
    const { data, error } = await supabase.from("storefronts").update({ settings: settings as any }).eq("id", sf.id).select().single();
    setSaving(false);
    if (error) return toast({ title: "Save failed", description: error.message, variant: "destructive" });
    onUpdate(data as any);
    toast({ title: "Payment methods saved" });
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Mobile banking wallets + Cash on Delivery. Each wallet has its own account details and instructions.
      </p>
      {WALLETS.map((w) => (
        <WalletEditor
          key={w}
          label={w === "bkash" ? "bKash" : w === "nagad" ? "Nagad" : w === "rocket" ? "Rocket" : w === "upay" ? "Upay" : "mCash"}
          value={draft.payments[w]}
          onChange={(v) => setWallet(w, v)}
          enabled={!!draft.methods[w]}
          onToggle={(v) => setEnabled(w, v)}
        />
      ))}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-medium">Cash on Delivery</h3>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Active at checkout</span>
              <Switch checked={!!draft.methods.cod} onCheckedChange={(v) => setEnabled("cod", v)} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Customer instructions</Label>
            <Input value={draft.payments.cod.instructions} onChange={(e) => setDraft({ ...draft, payments: { ...draft.payments, cod: { instructions: e.target.value } } })} placeholder="Shown to COD customers" />
          </div>
        </CardContent>
      </Card>
      <Button onClick={save} disabled={saving} className="gap-2">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Save payment methods
      </Button>
    </div>
  );
}
