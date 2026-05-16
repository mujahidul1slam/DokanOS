import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useBrand } from "../BrandContext";
import { useCart } from "../lib/cart";
import { brandBasePath, fmtBDT } from "../lib/brand";

interface City { city_id: number; city_name: string; }
interface Zone { zone_id: number; zone_name: string; city_id: number; }
interface Area { area_id: number; area_name: string; zone_id: number; }

export default function Checkout() {
  const navigate = useNavigate();
  const { brand, storefront } = useBrand();
  const { items, subtotal, clear } = useCart(brand);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [special, setSpecial] = useState("");
  const [payment, setPayment] = useState<"cod" | "bkash" | "nagad">("cod");
  const [trxId, setTrxId] = useState("");
  const [sender, setSender] = useState("");

  const [cities, setCities] = useState<City[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [cityId, setCityId] = useState<number | null>(null);
  const [zoneId, setZoneId] = useState<number | null>(null);
  const [areaId, setAreaId] = useState<number | null>(null);

  const [shipping, setShipping] = useState(150);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    supabase.from("pathao_cities").select("city_id, city_name").order("city_name").then(({ data }) => setCities(data || []));
  }, []);
  useEffect(() => {
    if (!cityId) { setZones([]); setZoneId(null); return; }
    supabase.from("pathao_zones").select("zone_id, zone_name, city_id").eq("city_id", cityId).order("zone_name").then(({ data }) => setZones(data || []));
    const dhakaCity = cities.find((c) => /dhaka/i.test(c.city_name));
    setShipping(dhakaCity && dhakaCity.city_id === cityId ? 80 : 150);
  }, [cityId, cities]);
  useEffect(() => {
    if (!zoneId) { setAreas([]); setAreaId(null); return; }
    supabase.from("pathao_areas").select("area_id, area_name, zone_id").eq("zone_id", zoneId).order("area_name").then(({ data }) => setAreas(data || []));
  }, [zoneId]);

  const total = subtotal + shipping;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!items.length) return;
    if (!name || !phone || !address || !cityId || !zoneId) {
      toast({ title: "Missing info", description: "Please fill all required fields.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("storefront-checkout", {
        body: {
          storefront_slug: brand,
          customer: { name, phone, email, address, city_id: cityId, zone_id: zoneId, area_id: areaId,
            city_name: cities.find((c) => c.city_id === cityId)?.city_name,
            zone_name: zones.find((z) => z.zone_id === zoneId)?.zone_name,
            area_name: areas.find((a) => a.area_id === areaId)?.area_name,
          },
          items: items.map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
          payment: { method: payment, trx_id: trxId || null, sender: sender || null },
          special_instruction: special || null,
        },
      });
      if (error) throw error;
      if (!data?.order_number) throw new Error("No order number returned");
      clear();
      navigate(`${brandBasePath(brand)}/checkout/success/${data.order_number}`);
    } catch (err: any) {
      toast({ title: "Could not place order", description: err.message || "Try again.", variant: "destructive" });
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
      <h1 className="sf-display text-5xl mb-10">Checkout</h1>
      <form onSubmit={handleSubmit} className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <section className="sf-glass p-6">
            <h2 className="sf-display text-xl mb-4">Contact & delivery</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <Input label="Full name *" value={name} onChange={setName} />
              <Input label="Phone *" value={phone} onChange={setPhone} placeholder="01XXXXXXXXX" />
              <Input label="Email" type="email" value={email} onChange={setEmail} className="sm:col-span-2" />
              <Select label="City *" value={cityId} onChange={setCityId} options={cities.map((c) => ({ value: c.city_id, label: c.city_name }))} />
              <Select label="Zone *" value={zoneId} onChange={setZoneId} options={zones.map((z) => ({ value: z.zone_id, label: z.zone_name }))} disabled={!cityId} />
              <Select label="Area" value={areaId} onChange={setAreaId} options={areas.map((a) => ({ value: a.area_id, label: a.area_name }))} disabled={!zoneId} className="sm:col-span-2" />
              <Input label="Address (house, road, landmark) *" value={address} onChange={setAddress} className="sm:col-span-2" />
              <Input label="Special instructions" value={special} onChange={setSpecial} className="sm:col-span-2" />
            </div>
          </section>

          <section className="sf-glass p-6">
            <h2 className="sf-display text-xl mb-4">Payment</h2>
            <div className="space-y-3">
              <PayOption value="cod" current={payment} onChange={setPayment} title="Cash on Delivery" subtitle="Pay when your order arrives" />
              <PayOption value="bkash" current={payment} onChange={setPayment} title="bKash (manual)" subtitle="Send to 01XXXXXXXXX (Personal) and enter TrxID below" />
              <PayOption value="nagad" current={payment} onChange={setPayment} title="Nagad (manual)" subtitle="Send to 01XXXXXXXXX (Personal) and enter TrxID below" />
              {(payment === "bkash" || payment === "nagad") && (
                <div className="grid sm:grid-cols-2 gap-3 pt-2">
                  <Input label="Transaction ID" value={trxId} onChange={setTrxId} />
                  <Input label="Sender number" value={sender} onChange={setSender} />
                </div>
              )}
            </div>
          </section>
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
                  <div className="truncate">{it.name}</div>
                  <div className="text-muted-foreground text-xs">Qty {it.quantity}</div>
                </div>
                <div>{fmtBDT(it.price * it.quantity)}</div>
              </div>
            ))}
          </div>
          <div className="space-y-2 text-sm border-t border-border pt-4">
            <Row label="Subtotal" value={fmtBDT(subtotal)} />
            <Row label="Shipping" value={fmtBDT(shipping)} />
            <div className="border-t border-border pt-2 flex justify-between text-lg">
              <span>Total</span><span className="font-medium">{fmtBDT(total)}</span>
            </div>
          </div>
          <button disabled={submitting} className="w-full mt-6 py-4 rounded-full bg-primary text-primary-foreground text-sm uppercase tracking-widest hover:opacity-90 transition disabled:opacity-60 inline-flex items-center justify-center gap-2">
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
      <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
        className="w-full bg-background border border-input rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary"/>
    </label>
  );
}

function Select({ label, value, onChange, options, disabled, className = "" }: any) {
  return (
    <label className={`block ${className}`}>
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <select disabled={disabled} value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        className="w-full bg-background border border-input rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary disabled:opacity-50">
        <option value="">— Select —</option>
        {options.map((o: any) => (<option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
    </label>
  );
}

function PayOption({ value, current, onChange, title, subtitle }: any) {
  const active = current === value;
  return (
    <button type="button" onClick={() => onChange(value)}
      className={`w-full text-left p-4 rounded-xl border transition ${active ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}>
      <div className="flex items-center gap-3">
        <span className={`h-4 w-4 rounded-full border-2 ${active ? "border-primary" : "border-muted-foreground"} flex items-center justify-center`}>
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
  return <div className="flex justify-between"><span className="text-muted-foreground">{label}</span><span>{value}</span></div>;
}
