import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OnboardingStepProps } from "../stepProps";
import { StepFooter } from "./StepFooter";

// Allow-list of currencies the provisioning RPC accepts (see
// create_business_with_owner / BusinessAccountTab.CURRENCIES).
const CURRENCIES = ["BDT", "USD", "EUR", "GBP", "INR", "MYR", "SAR", "AED"];

/**
 * Wizard step 1 (spec §6a: "business profile — name, currency, contact
 * basics"). Edits the businesses row created moments earlier; saving marks the
 * step completed and advances. Skip marks the step skipped — nothing here is
 * mandatory for the business to work.
 */
export function BusinessProfileStep({
  business,
  businessId,
  onFinished,
  onBack,
  onContextRefresh,
}: OnboardingStepProps) {
  const [name, setName] = useState(business.name);
  const [currency, setCurrency] = useState(business.currency || "BDT");
  const [email, setEmail] = useState(business.email ?? "");
  const [phone, setPhone] = useState(business.phone ?? "");
  const [address, setAddress] = useState(business.address ?? "");
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Business name is required");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from("businesses")
      .update({
        name: trimmed,
        currency,
        email: email.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
      })
      .eq("id", businessId)
      .select("id");
    if (error || !data || data.length === 0) {
      setSaving(false);
      toast.error("Could not save the business profile. Please try again.");
      return;
    }
    onContextRefresh();
    await onFinished("completed");
    setSaving(false);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="onboarding-biz-name">Business name</Label>
        <Input
          id="onboarding-biz-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Apex Sportswear"
          maxLength={100}
          required
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <Label>Currency</Label>
        <Select value={currency} onValueChange={setCurrency}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select currency" />
          </SelectTrigger>
          <SelectContent>
            {(CURRENCIES.includes(currency) ? CURRENCIES : [currency, ...CURRENCIES]).map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="onboarding-biz-email">Contact email</Label>
          <Input
            id="onboarding-biz-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="orders@example.com"
            autoComplete="email"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="onboarding-biz-phone">Phone</Label>
          <Input
            id="onboarding-biz-phone"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="01XXXXXXXXX"
            autoComplete="tel"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="onboarding-biz-address">Address</Label>
        <Textarea
          id="onboarding-biz-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          rows={2}
          placeholder="Street, city — shown on invoices"
        />
      </div>

      <StepFooter onBack={onBack} onSkip={() => void onFinished("skipped")} busy={saving}>
        <Button type="submit" disabled={saving}>
          Save and continue
        </Button>
      </StepFooter>
    </form>
  );
}
