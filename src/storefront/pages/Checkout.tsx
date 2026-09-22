import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useBrand } from "../BrandContext";
import { useCart } from "../lib/cart";
import { brandBasePath } from "../lib/brand";
import { useCurrency } from "../lib/useCurrency";
import { mergeSettings, type StorefrontPaymentMethod } from "../lib/settings";

interface City { city_id: number; city_name: string; }
interface Zone { zone_id: number; zone_name: string; city_id: number; }
interface Area { area_id: number; area_name: string; zone_id: number; }

interface ShippingQuote {
  inside_dhaka: number;
  outside_dhaka: number;
  rate: number;
  is_inside_dhaka: boolean;
  free_threshold: number;
  currency: string;
}

export default function Checkout() {
  const navigate = useNavigate();
  const { brand, storefront } = useBrand();
  const { items, subtotal, clear } = useCart(brand);
  const fmt = useCurrency();

  const settings = useMemo(() => mergeSettings(storefront.settings), [storefront.settings]);
  const enabledMethods = settings.checkout.methods;
  const payConf = settings.payments;
  const delivery = settings.delivery;

  // Determine initial payment method from enabled methods
  const initialPaymentMethod = enabledMethods.cod
    ? "cod"
    : enabledMethods.bkash
    ? "bkash"
    : enabledMethods.nagad
    ? "nagad"
    : enabledMethods.rocket
    ? "rocket"
    : enabledMethods.upay
    ? "upay"
    : enabledMethods.mcash
    ? "mcash"
    : "cod";

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [special, setSpecial] = useState("");
  const [payment, setPayment] = useState<string>(initialPaymentMethod);
  const [trxId, setTrxId] = useState("");
  const [sender, setSender] = useState("");
  const [agreedTerms, setAgreedTerms] = useState(false);

  const [cities, setCities] = useState<City[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [cityId, setCityId] = useState<number | null>(null);
  const [zoneId, setZoneId] = useState<number | null>(null);
  const [areaId, setAreaId] = useState<number | null>(null);

  const [shippingQuote, setShippingQuote] = useState<ShippingQuote | null>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Idempotency key per cart session
  const [idempotencyKey] = useState(() => {
    const k = `sf_idem_${brand}`;
    let existing = localStorage.getItem(k);
    if (!existing) {
      existing = crypto.randomUUID();
      localStorage.setItem(k, existing);
    }
    return existing;
  });

  // Ensure selected payment method remains valid if settings change
  useEffect(() => {
    if (!enabledMethods[payment]) {
      setPayment(initialPaymentMethod);
    }
  }, [enabledMethods, payment, initialPaymentMethod]);

  // Load pathao cities
  useEffect(() => {
    supabase
      .from("pathao_cities")
      .select("city_id, city_name")
      .order("city_name")
      .then(({ data }) => setCities(data || []));
  }, []);

  // Fetch shipping quote dynamically via edge function (deletes client 80/150 hard-code)
  useEffect(() => {
    let alive = true;
    setLoadingQuote(true);
    supabase.functions
      .invoke("storefront-shipping-quote", {
        body: { storefront_slug: brand, city_id: cityId },
      })
      .then(({ data, error }) => {
        if (!alive) return;
        if (error || !data) {
          // Fallback quote if function unavailable
          setShippingQuote({
            inside_dhaka: 80,
            outside_dhaka: 150,
            rate: 150,
            is_inside_dhaka: false,
            free_threshold: settings.shipping.free_threshold,
            currency: storefront.currency || "BDT",
          });
        } else {
          setShippingQuote(data as ShippingQuote);
        }
      })
      .finally(() => {
        if (alive) setLoadingQuote(false);
      });

    return () => {
      alive = false;
    };
  }, [cityId, brand, settings.shipping.free_threshold, storefront.currency]);

  // Update zones on city change
  useEffect(() => {
    if (!cityId) {
      setZones([]);
      setZoneId(null);
      return;
    }
    supabase
      .from("pathao_zones")
      .select("zone_id, zone_name, city_id")
      .eq("city_id", cityId)
      .order("zone_name")
      .then(({ data }) => setZones(data || []));
  }, [cityId]);

  // Update areas on zone change
  useEffect(() => {
    if (!zoneId) {
      setAreas([]);
      setAreaId(null);
      return;
    }
    supabase
      .from("pathao_areas")
      .select("area_id, area_name, zone_id")
      .eq("zone_id", zoneId)
      .order("area_name")
      .then(({ data }) => setAreas(data || []));
  }, [zoneId]);

  const freeThreshold = shippingQuote?.free_threshold || settings.shipping.free_threshold || 0;
  const isFreeShipping = freeThreshold > 0 && subtotal >= freeThreshold;
  const effectiveShipping = isFreeShipping ? 0 : (shippingQuote?.rate ?? 150);
  const total = subtotal + effectiveShipping;

  // Advance payment (settings-driven): customer pays X% online, rest COD
  const advanceEnabled = delivery.advance_payment_enabled && delivery.advance_percent > 0;
  const advanceAmount = advanceEnabled ? Math.round((total * Math.min(delivery.advance_percent, 100)) / 100) : 0;
  const amountDueOnDelivery = advanceEnabled ? total - advanceAmount : total;
  const advanceAllowed = advanceEnabled && payment !== "cod" && (payment === "bkash" || payment === "nagad" || payment === "rocket" || payment === "upay" || payment === "mcash");

  const minOrderAmount = settings.checkout.min_order_amount || 0;
  const isBelowMinOrder = minOrderAmount > 0 && subtotal < minOrderAmount;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!items.length) return;
    if (!name || !phone || !address || !cityId || !zoneId) {
      toast({ title: "Missing info", description: "Please fill all required fields.", variant: "destructive" });
      return;
    }
    if (isBelowMinOrder) {
      toast({
        title: "Minimum order amount not met",
        description: `Minimum order is ${fmt(minOrderAmount)}. Your subtotal is ${fmt(subtotal)}.`,
        variant: "destructive",
      });
      return;
    }
    if (settings.checkout.terms_checkbox_text && !agreedTerms) {
      toast({
        title: "Terms agreement required",
        description: "Please agree to the terms to proceed.",
        variant: "destructive",
      });
      return;
    }
    if (advanceEnabled && payment === "cod") {
      toast({
        title: "Advance payment required",
        description: "This store requires an online advance. Please choose a wallet method (bKash / Nagad / Rocket / Upay / mCash).",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("storefront-checkout", {
        body: {
          storefront_slug: brand,
          idempotency_key: idempotencyKey,
          customer: {
            name,
            phone,
            email: email || null,
            address,
            city_id: cityId,
            zone_id: zoneId,
            area_id: areaId,
            city_name: cities.find((c) => c.city_id === cityId)?.city_name,
            zone_name: zones.find((z) => z.zone_id === zoneId)?.zone_name,
            area_name: areas.find((a) => a.area_id === areaId)?.area_name,
          },
          items: items.map((i) => ({
            product_id: i.product_id,
            variation_id: i.variation_id || null,
            variation_label: i.variation_label || null,
            quantity: i.quantity,
          })),
          payment: {
            method: payment,
            trx_id: trxId || null,
            sender: sender || null,
            advance_amount: advanceAmount > 0 ? advanceAmount : undefined,
            advance_due_on_delivery: advanceAmount > 0 ? amountDueOnDelivery : undefined,
          },
          special_instruction: special || null,
        },
      });
      if (error) throw error;
      if (!data?.order_number) throw new Error("No order number returned");

      // Success: clear cart & idempotency key
      localStorage.removeItem(`sf_idem_${brand}`);
      clear();
      navigate(`${brandBasePath(brand)}/checkout/success/${data.order_number}`);
    } catch (err: any) {
      toast({
        title: "Could not place order",
        description: err.message || "Try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (!items.length) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-32 text-center">
        <h1 className="sf-display text-3xl mb-4">Your bag is empty</h1>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 lg:px-8 py-12">
      <h1 className="sf-display text-5xl mb-6">Checkout</h1>

      {/* Step indicator — user is on the Details step while filling the form */}
      <CheckoutStepper current={1} />

      {/* Order Instructions from Settings */}
      {settings.checkout.order_instructions && (
        <div className="sf-glass p-4 rounded-xl mb-8 text-sm text-foreground/85 border border-primary/20 bg-primary/5">
          <p className="whitespace-pre-line">{settings.checkout.order_instructions}</p>
        </div>
      )}

      {/* Minimum Order Warning */}
      {isBelowMinOrder && (
        <div className="p-4 rounded-xl mb-8 text-sm bg-destructive/10 border border-destructive/30 text-destructive font-medium">
          Minimum order amount is {fmt(minOrderAmount)}. Please add more items to your bag.
        </div>
      )}

      <form onSubmit={handleSubmit} className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <section className="sf-glass p-6">
            <h2 className="sf-display text-xl mb-4">Contact & delivery</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <Input label="Full name *" value={name} onChange={setName} />
              <Input label="Phone *" value={phone} onChange={setPhone} placeholder="01XXXXXXXXX" />
              <Input label="Email" type="email" value={email} onChange={setEmail} className="sm:col-span-2" />
              <Select
                label="City *"
                value={cityId}
                onChange={setCityId}
                options={cities.map((c) => ({ value: c.city_id, label: c.city_name }))}
              />
              <Select
                label="Zone *"
                value={zoneId}
                onChange={setZoneId}
                options={zones.map((z) => ({ value: z.zone_id, label: z.zone_name }))}
                disabled={!cityId}
              />
              {delivery.show_upazila && (
                <Select
                  label="Area"
                  value={areaId}
                  onChange={setAreaId}
                  options={areas.map((a) => ({ value: a.area_id, label: a.area_name }))}
                  disabled={!zoneId}
                  className="sm:col-span-2"
                />
              )}
              <Input
                label="Address (house, road, landmark) *"
                value={address}
                onChange={setAddress}
                className="sm:col-span-2"
              />
              <Input
                label="Special instructions"
                value={special}
                onChange={setSpecial}
                className="sm:col-span-2"
              />
            </div>
          </section>

          <section className="sf-glass p-6">
            <h2 className="sf-display text-xl mb-4">Payment</h2>
            <div className="space-y-3">
              {enabledMethods.cod && (
                <PayOption
                  value="cod"
                  current={payment}
                  onChange={setPayment}
                  title="Cash on Delivery"
                  subtitle={payConf.cod.instructions || "Pay when your order arrives"}
                />
              )}
              {enabledMethods.bkash && (
                <WalletOption value={payConf.bkash} payKey="bkash" current={payment} onChange={setPayment} />
              )}
              {enabledMethods.nagad && (
                <WalletOption value={payConf.nagad} payKey="nagad" current={payment} onChange={setPayment} />
              )}
              {enabledMethods.rocket && (
                <WalletOption value={payConf.rocket} payKey="rocket" current={payment} onChange={setPayment} />
              )}
              {enabledMethods.upay && (
                <WalletOption value={payConf.upay} payKey="upay" current={payment} onChange={setPayment} />
              )}
              {enabledMethods.mcash && (
                <WalletOption value={payConf.mcash} payKey="mcash" current={payment} onChange={setPayment} />
              )}
              {(payment === "bkash" || payment === "nagad" || payment === "rocket" || payment === "upay" || payment === "mcash") && (
                <div className="grid sm:grid-cols-2 gap-3 pt-2">
                  <Input label="Transaction ID *" value={trxId} onChange={setTrxId} />
                  {(payConf as any)[payment]?.ask_for_phone && (
                    <Input label="Sender number" value={sender} onChange={setSender} />
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Terms Checkbox */}
          {settings.checkout.terms_checkbox_text && (
            <section className="sf-glass p-4 rounded-xl">
              <label className="flex items-start gap-3 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={agreedTerms}
                  onChange={(e) => setAgreedTerms(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                />
                <span className="text-foreground/90 leading-normal">
                  {settings.checkout.terms_checkbox_text}
                </span>
              </label>
            </section>
          )}
        </div>

        <aside className="sf-glass p-6 h-fit sticky top-24">
          <h2 className="sf-display text-2xl mb-6">Order</h2>
          <div className="space-y-3 mb-6 max-h-72 overflow-auto">
            {items.map((it) => (
              <div key={`${it.product_id}-${it.variation_id || ""}`} className="flex gap-3 items-center text-sm">
                <div className="h-14 w-12 bg-muted rounded overflow-hidden flex-shrink-0">
                  {it.image_url && <img src={it.image_url} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{it.name}</div>
                  {it.variation_label && (
                    <div className="text-xs text-primary font-medium">{it.variation_label}</div>
                  )}
                  <div className="text-muted-foreground text-xs">Qty {it.quantity}</div>
                </div>
                <div className="font-medium">{fmt(it.price * it.quantity)}</div>
              </div>
            ))}
          </div>

          <div className="space-y-2 text-sm border-t border-border pt-4">
            <Row label="Subtotal" value={fmt(subtotal)} />
            <Row
              label="Shipping"
              value={
                loadingQuote
                  ? "Calculating…"
                  : isFreeShipping
                  ? "Free"
                  : fmt(effectiveShipping)
              }
            />
            {freeThreshold > 0 && !isFreeShipping && (
              <p className="text-[11px] text-muted-foreground">
                Add {fmt(freeThreshold - subtotal)} more for free delivery!
              </p>
            )}
            <div className="border-t border-border pt-2 flex justify-between text-lg">
              <span>Total</span>
              <span className="font-medium">{fmt(total)}</span>
            </div>
          </div>

          {advanceAmount > 0 && (
            <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs space-y-1">
              <p className="font-medium text-primary">Advance payment required</p>
              <div className="flex justify-between"><span className="text-muted-foreground">Pay now ({payment.toUpperCase()})</span><span>{fmt(advanceAmount)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">On delivery</span><span>{fmt(amountDueOnDelivery)}</span></div>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || isBelowMinOrder || (Boolean(settings.checkout.terms_checkbox_text) && !agreedTerms)}
            className="w-full mt-6 py-4 rounded-full bg-primary text-primary-foreground text-sm uppercase tracking-widest hover:opacity-90 transition disabled:opacity-60 inline-flex items-center justify-center gap-2"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? "Placing order…" : "Place order"}
          </button>
          <p className="text-xs text-muted-foreground mt-3 text-center">
            {storefront.name} · {storefront.currency}
          </p>
        </aside>
      </form>
    </div>
  );
}

function Input({ label, value, onChange, type = "text", placeholder, className = "" }: any) {
  return (
    <label className={`block ${className}`}>
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-background border border-input rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary"
      />
    </label>
  );
}

function Select({ label, value, onChange, options, disabled, className = "" }: any) {
  return (
    <label className={`block ${className}`}>
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <select
        disabled={disabled}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        className="w-full bg-background border border-input rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary disabled:opacity-50"
      >
        <option value="">— Select —</option>
        {options.map((o: any) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function WalletOption({ value, payKey, current, onChange }: {
  value: StorefrontPaymentMethod;
  payKey: string;
  current: string;
  onChange: (v: string) => void;
}) {
  const pretty = { bkash: "bKash", nagad: "Nagad", rocket: "Rocket", upay: "Upay", mcash: "mCash" }[payKey] ?? payKey;
  const sub = [value.account_number && `Send to ${value.account_number}`, value.instructions].filter(Boolean).join(" · ") || "Pay with mobile banking — enter TrxID below";
  return (
    <PayOption value={payKey} current={current} onChange={onChange} title={pretty} subtitle={sub} />
  );
}

function PayOption({ value, current, onChange, title, subtitle }: any) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      className={`w-full text-left p-4 rounded-xl border transition ${
        active ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`h-4 w-4 rounded-full border-2 ${
            active ? "border-primary" : "border-muted-foreground"
          } flex items-center justify-center`}
        >
          {active && <span className="h-2 w-2 rounded-full bg-primary" />}
        </span>
        <div>
          <div className="font-medium text-sm">{title}</div>
          <div className="text-xs text-muted-foreground">{subtitle}</div>
        </div>
      </div>
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

/** Checkout stepper — Cart → Contact & payment → Done (Bonik parity B2). */
function CheckoutStepper({ current }: { current: number }) {
  const STEPS = ["Cart", "Details", "Done"];
  return (
    <div className="flex items-center gap-2 mb-10" aria-label="Checkout progress">
      {STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={step} className="flex items-center gap-2">
            <span
              className={`h-6 w-6 rounded-full text-[11px] font-semibold flex items-center justify-center transition-colors ${
                done ? "bg-primary text-primary-foreground" : active ? "bg-primary/10 text-primary border border-primary" : "bg-muted text-muted-foreground"
              }`}
            >
              {i + 1}
            </span>
            <span className={`text-xs uppercase tracking-widest ${active ? "text-primary font-semibold" : "text-muted-foreground"}`}>{step}</span>
            {i < STEPS.length - 1 && <span className="w-8 h-px bg-border" />}
          </div>
        );
      })}
    </div>
  );
}
