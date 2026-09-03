import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Warehouse, Store as StoreIcon, Plug, Package, Users, Plus, Trash2, Pencil,
  MapPin, Globe, Truck, Loader2, Building2, Factory,
} from "lucide-react";

/**
 * Multi-business Phase 2: the Stores hub.
 *
 * /stores becomes Account > Business > Brands, where each brand card exposes
 * the 5 configuration areas (Locations, Selling Points, Connectors, Product
 * Sources, Customer Sources) + the existing Woo store controls (sync etc.).
 */

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------
interface LocationRow {
  id: string; brand_id: string; name: string; type: string;
  address: string | null; city: string | null; is_default: boolean; is_active: boolean;
}
interface SellingPointRow {
  id: string; brand_id: string; name: string; type: string;
  location_id: string | null; woo_store_id: string | null; storefront_id: string | null;
  is_default: boolean; is_active: boolean;
}
interface ConnectorRow {
  id: string; brand_id: string | null; category: string; type: string;
  name: string; status: string; last_sync_at: string | null;
}
interface SourceRow {
  id: string; brand_id: string | null; name: string; type: string;
  status: string; sync_direction: string; last_sync_at: string | null;
}
interface SupplierRow {
  id: string; name: string; is_factory: boolean; contact_name: string | null;
  phone: string | null; city: string | null; is_active: boolean;
}

const SP_TYPE_LABELS: Record<string, string> = {
  woocommerce: "WooCommerce", shopify: "Shopify", dokanos_storefront: "Storefront",
  showroom_pos: "Showroom POS", facebook: "Facebook", instagram: "Instagram",
  tiktok: "TikTok", google: "Google", whatsapp: "WhatsApp", marketplace: "Marketplace", other: "Other",
};
const CONNECTOR_CAT_LABELS: Record<string, string> = {
  channel: "Channel", courier: "Courier", payment: "Payments",
  accounting: "Accounting", marketing: "Marketing", other: "Other",
};

export default function StoresHub() {
  const { active, brands, loading: ctxLoading } = useBusinessContext();
  const [expandedBrand, setExpandedBrand] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("locations");

  if (ctxLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Business header */}
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-secondary">
            <Building2 className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Business Account</p>
            <h1 className="font-heading text-xl font-semibold">{active?.name || "No business"}</h1>
          </div>
          <Badge variant="secondary" className="ml-auto">
            {brands.length} brand{brands.length === 1 ? "" : "s"}
          </Badge>
        </div>
        {brands.length === 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            No brands yet. Brands are created automatically when a WooCommerce store is connected.
          </p>
        )}
      </div>

      {/* Brand cards */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {brands.map((brand) => (
          <BrandCard
            key={brand.id}
            brand={brand}
            expanded={expandedBrand === brand.id}
            onToggle={() => setExpandedBrand(expandedBrand === brand.id ? null : brand.id)}
            tab={tab}
            onTabChange={setTab}
          />
        ))}
      </div>
    </div>
  );
}

function BrandCard({
  brand, expanded, onToggle, tab, onTabChange,
}: {
  brand: { id: string; name: string; slug: string; woo_store_id: string | null };
  expanded: boolean; onToggle: () => void; tab: string; onTabChange: (t: string) => void;
}) {
  const { toast } = useToast();
  const [wooStore, setWooStore] = useState<{ id: string; name: string; url: string; status: string; last_synced_at: string | null } | null>(null);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [sellingPoints, setSellingPoints] = useState<SellingPointRow[]>([]);
  const [connectors, setConnectors] = useState<ConnectorRow[]>([]);
  const [productSources, setProductSources] = useState<SourceRow[]>([]);
  const [customerSources, setCustomerSources] = useState<SourceRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    if (brand.woo_store_id) {
      const { data: s } = await supabase
        .from("stores")
        .select("id, name, url, status, last_synced_at")
        .eq("id", brand.woo_store_id)
        .maybeSingle();
      setWooStore(s as { id: string; name: string; url: string; status: string; last_synced_at: string | null } | null);
    }
    const [loc, sp, conn, psrc, csrc, sup] = await Promise.all([
      supabase.from("locations").select("*").eq("brand_id", brand.id).order("name"),
      supabase.from("selling_points").select("*").eq("brand_id", brand.id).order("name"),
      supabase.from("connectors").select("*").or(`brand_id.eq.${brand.id},brand_id.is.null`).order("category").order("name"),
      supabase.from("product_sources").select("*").or(`brand_id.eq.${brand.id},brand_id.is.null`).order("name"),
      supabase.from("customer_sources").select("*").or(`brand_id.eq.${brand.id},brand_id.is.null`).order("name"),
      supabase.from("suppliers").select("*").order("name"),
    ]);
    setLocations((loc.data as LocationRow[]) || []);
    setSellingPoints((sp.data as SellingPointRow[]) || []);
    setConnectors((conn.data as ConnectorRow[]) || []);
    setProductSources((psrc.data as SourceRow[]) || []);
    setCustomerSources((csrc.data as SourceRow[]) || []);
    setSuppliers((sup.data as SupplierRow[]) || []);
  }, [brand.id, brand.woo_store_id]);

  useEffect(() => { load(); }, [load]);

  const syncWoo = async () => {
    if (!wooStore) return;
    setSyncing(true);
    try {
      const { error } = await supabase.functions.invoke("woo-sync", { body: { store_id: wooStore.id } });
      if (error) throw error;
      toast({ title: "Sync started", description: "Running in background — status will update." });
      load();
    } catch (e: unknown) {
      toast({ title: "Sync failed", description: (e as Error)?.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const TABS = [
    { id: "locations", label: "Locations", icon: MapPin, count: locations.length },
    { id: "selling", label: "Selling Points", icon: StoreIcon, count: sellingPoints.length },
    { id: "connectors", label: "Connectors", icon: Plug, count: connectors.length },
    { id: "psources", label: "Product Sources", icon: Package, count: productSources.length },
    { id: "csources", label: "Customer Sources", icon: Users, count: customerSources.length },
    { id: "suppliers", label: "Suppliers", icon: Factory, count: suppliers.length },
  ];

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Brand header */}
      <div className="flex items-center gap-3 p-5 cursor-pointer hover:bg-secondary/20 transition-colors" onClick={onToggle}>
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
          <StoreIcon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <p className="font-heading text-sm font-semibold">{brand.name}</p>
          <p className="text-xs text-muted-foreground truncate">
            {wooStore ? wooStore.url : "No WooCommerce store linked"}
          </p>
        </div>
        {wooStore && (
          <Badge variant={wooStore.status === "connected" ? "default" : "secondary"} className="ml-auto">
            {wooStore.status}
          </Badge>
        )}
      </div>

      {wooStore && (
        <div className="px-5 pb-3 flex gap-2 items-center text-xs text-muted-foreground">
          <span>
            {wooStore.last_synced_at
              ? `Synced ${new Date(wooStore.last_synced_at).toLocaleString()}`
              : "Never synced"}
          </span>
          <Button size="sm" variant="outline" disabled={syncing} onClick={syncWoo} className="ml-auto">
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Sync Now"}
          </Button>
        </div>
      )}

      {/* Tabs */}
      <div className="border-t border-border px-2 pt-2 overflow-x-auto">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => onTabChange(t.id)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors whitespace-nowrap ${
                expanded && tab === t.id
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
              <span className="text-[10px] opacity-60">{t.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Panel (visible when brand expanded) */}
      {expanded && (
        <div className="border-t border-border p-4">
          {tab === "locations" && <LocationsPanel brandId={brand.id} rows={locations} onChanged={load} />}
          {tab === "selling" && <SellingPointsPanel brandId={brand.id} locations={locations} rows={sellingPoints} onChanged={load} />}
          {tab === "connectors" && <ConnectorsPanel rows={connectors} />}
          {tab === "psources" && <SourcesPanel kind="product" brandId={brand.id} rows={productSources} onChanged={load} />}
          {tab === "csources" && <SourcesPanel kind="customer" brandId={brand.id} rows={customerSources} onChanged={load} />}
          {tab === "suppliers" && <SuppliersPanel rows={suppliers} onChanged={load} />}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Locations panel
// ---------------------------------------------------------------------------
function LocationsPanel({ brandId, rows, onChanged }: { brandId: string; rows: LocationRow[]; onChanged: () => void }) {
  const { active } = useBusinessContext();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", type: "warehouse", city: "", address: "", is_default: false });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.name) return;
    setSaving(true);
    const { error } = await supabase.from("locations").insert({
      business_id: active!.id, brand_id: brandId,
      name: form.name, type: form.type, city: form.city || null,
      address: form.address || null, is_default: form.is_default,
    });
    setSaving(false);
    if (error) { /* toast handled by caller pattern */ }
    setOpen(false);
    setForm({ name: "", type: "warehouse", city: "", address: "", is_default: false });
    onChanged();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Warehouses & showrooms this brand fulfills from.</p>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">No locations.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((l) => (
            <div key={l.id} className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2">
              <Warehouse className="h-4 w-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">{l.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {l.type}{l.city ? ` · ${l.city}` : ""}{l.address ? ` · ${l.address}` : ""}
                </p>
              </div>
              {l.is_default && <Badge variant="secondary" className="text-[10px]">Default</Badge>}
            </div>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Location</DialogTitle>
            <DialogDescription>Warehouse (stock source) or showroom (selling place).</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Main Warehouse" />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                <option value="warehouse">Warehouse</option>
                <option value="showroom">Showroom</option>
                <option value="store">Store</option>
                <option value="online">Online (virtual)</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>City</Label>
              <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Dhaka" />
            </div>
            <div className="space-y-1.5">
              <Label>Address</Label>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />
              Set as default location
            </label>
          </div>
          <DialogFooter>
            <Button onClick={save} disabled={saving || !form.name}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Selling points panel (merged channels — one typed list per brand)
// ---------------------------------------------------------------------------
function SellingPointsPanel({
  brandId, locations, rows, onChanged,
}: { brandId: string; locations: LocationRow[]; rows: SellingPointRow[]; onChanged: () => void }) {
  const { active } = useBusinessContext();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", type: "other", location_id: "" });
  const [saving, setSaving] = useState(false);

  const needsLocation = ["showroom_pos"].includes(form.type);

  const save = async () => {
    if (!form.name) return;
    setSaving(true);
    await supabase.from("selling_points").insert({
      business_id: active!.id, brand_id: brandId,
      name: form.name, type: form.type,
      location_id: needsLocation && form.location_id ? form.location_id : null,
    });
    setSaving(false);
    setOpen(false);
    setForm({ name: "", type: "other", location_id: "" });
    onChanged();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Channels & outlets producing orders for this brand.</p>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">No selling points.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((sp) => (
            <div key={sp.id} className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2">
              {sp.type === "showroom_pos" ? <StoreIcon className="h-4 w-4 text-muted-foreground" />
                : sp.type === "woocommerce" ? <Globe className="h-4 w-4 text-muted-foreground" />
                : <StoreIcon className="h-4 w-4 text-muted-foreground" />}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">{sp.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {SP_TYPE_LABELS[sp.type] || sp.type}
                  {sp.is_default ? " · default" : ""}
                </p>
              </div>
              {sp.is_active ? <Badge variant="secondary" className="text-[10px]">Active</Badge>
                : <Badge variant="outline" className="text-[10px]">Inactive</Badge>}
            </div>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Selling Point</DialogTitle>
            <DialogDescription>A channel or outlet (merged list) — POS types bind to a location.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Dhanmondi Showroom" />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                {Object.entries(SP_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            {needsLocation && (
              <div className="space-y-1.5">
                <Label>Location</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.location_id}
                  onChange={(e) => setForm({ ...form, location_id: e.target.value })}
                >
                  <option value="">Select location…</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.type})</option>)}
                </select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={save} disabled={saving || !form.name}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Suppliers panel (suppliers/factories — business-scoped)
// ---------------------------------------------------------------------------
function SuppliersPanel({ rows, onChanged }: { rows: SupplierRow[]; onChanged: () => void }) {
  const { active } = useBusinessContext();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", is_factory: false, contact_name: "", phone: "", city: "" });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.name) return;
    setSaving(true);
    await supabase.from("suppliers").insert({
      business_id: active!.id,
      name: form.name,
      is_factory: form.is_factory,
      contact_name: form.contact_name || null,
      phone: form.phone || null,
      city: form.city || null,
    });
    setSaving(false);
    setOpen(false);
    setForm({ name: "", is_factory: false, contact_name: "", phone: "", city: "" });
    onChanged();
  };

  const toggleActive = async (s: SupplierRow) => {
    await supabase.from("suppliers").update({ is_active: !s.is_active }).eq("id", s.id);
    onChanged();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Vendors & factories for this business (purchase orders in a later phase).
        </p>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">No suppliers yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2">
              <Factory className="h-4 w-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">{s.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {s.is_factory ? "Factory" : "Vendor"}
                  {s.contact_name ? ` · ${s.contact_name}` : ""}
                  {s.phone ? ` · ${s.phone}` : ""}
                  {s.city ? ` · ${s.city}` : ""}
                </p>
              </div>
              <button
                onClick={() => toggleActive(s)}
                className={`text-[10px] rounded-full px-2 py-0.5 ${s.is_active ? "bg-emerald-500/10 text-emerald-600" : "bg-secondary text-muted-foreground"}`}
              >
                {s.is_active ? "Active" : "Inactive"}
              </button>
            </div>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Supplier</DialogTitle>
            <DialogDescription>Vendors supply products; factories manufacture them.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ACME Fabrics" />
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={form.is_factory}
                onChange={(e) => setForm({ ...form, is_factory: e.target.checked })}
              />
              This is a factory
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Contact</Label>
                <Input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>City</Label>
              <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={save} disabled={saving || !form.name}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connectors panel (channels + couriers)
// ---------------------------------------------------------------------------
function ConnectorsPanel({ rows }: { rows: ConnectorRow[] }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Integrations registered for this brand — WooCommerce channels and couriers (Pathao) today.
      </p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">No connectors.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2">
              {c.category === "courier" ? <Truck className="h-4 w-4 text-muted-foreground" />
                : <Globe className="h-4 w-4 text-muted-foreground" />}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">{c.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {CONNECTOR_CAT_LABELS[c.category] || c.category} · {c.type}
                </p>
              </div>
              <Badge variant={c.status === "connected" ? "default" : "secondary"} className="text-[10px]">
                {c.status}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sources panel (product & customer sources — registry view in v1)
// ---------------------------------------------------------------------------
function SourcesPanel({
  kind, brandId, rows, onChanged,
}: { kind: "product" | "customer"; brandId: string; rows: SourceRow[]; onChanged: () => void }) {
  const { active } = useBusinessContext();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", type: "other", sync_direction: "import" });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.name) return;
    setSaving(true);
    if (kind === "product") {
      await supabase.from("product_sources").insert({
        business_id: active!.id, brand_id: brandId,
        name: form.name, type: form.type, sync_direction: form.sync_direction,
      });
    } else {
      await supabase.from("customer_sources").insert({
        business_id: active!.id, brand_id: brandId,
        name: form.name, type: form.type, sync_direction: form.sync_direction,
      });
    }
    setSaving(false);
    setOpen(false);
    setForm({ name: "", type: "other", sync_direction: "import" });
    onChanged();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {kind === "product"
            ? "Where this brand's catalog comes from."
            : "Where this brand's customers come from."}
        </p>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">No sources registered.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2">
              <Package className="h-4 w-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">{s.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {s.type} · {s.sync_direction}
                </p>
              </div>
              <Badge variant={s.status === "connected" ? "default" : "secondary"} className="text-[10px]">
                {s.status}
              </Badge>
            </div>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add {kind === "product" ? "Product" : "Customer"} Source</DialogTitle>
            <DialogDescription>Registry entry — connector-style configuration (v1: manual).</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Excel import" />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                <option value="excel">Excel</option>
                <option value="csv">CSV</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Sync direction</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.sync_direction}
                onChange={(e) => setForm({ ...form, sync_direction: e.target.value })}
              >
                <option value="import">Import</option>
                <option value="export">Export</option>
                <option value="two_way">Two-way</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={save} disabled={saving || !form.name}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
