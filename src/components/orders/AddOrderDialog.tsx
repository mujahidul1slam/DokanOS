import { useState, useEffect, useMemo } from "react";
import { Search, Plus, Minus, Trash2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

interface ProductRow {
  id: string;
  name: string;
  sku: string | null;
  price: number;
  stock_quantity: number;
  image_url: string | null;
}

interface VariationRow {
  id: string;
  product_id: string;
  name: string;
  sku: string | null;
  price: number;
  stock_quantity: number;
  attributes: any;
}

interface SearchResult {
  id: string; // product_id or variation_id
  productId: string;
  variationId?: string;
  name: string;
  variationLabel?: string;
  sku: string | null;
  price: number;
}

interface OrderItem {
  uid: string; // unique key for cart
  productId: string;
  variationId?: string;
  name: string;
  variationLabel?: string;
  price: number;
  qty: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export default function AddOrderDialog({ open, onOpenChange, onCreated }: Props) {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [variations, setVariations] = useState<VariationRow[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [items, setItems] = useState<OrderItem[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [fulfillment, setFulfillment] = useState<"pickup" | "delivery">("delivery");
  const [source, setSource] = useState("phone");
  const [sources, setSources] = useState<{ id: string; name: string }[]>([]);
  const [shippingCost, setShippingCost] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Pathao location
  const [cities, setCities] = useState<{ city_id: number; city_name: string }[]>([]);
  const [zones, setZones] = useState<{ zone_id: number; zone_name: string }[]>([]);
  const [areas, setAreas] = useState<{ area_id: number; area_name: string }[]>([]);
  const [selectedCity, setSelectedCity] = useState<number | null>(null);
  const [selectedZone, setSelectedZone] = useState<number | null>(null);
  const [selectedArea, setSelectedArea] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    // Fetch products, variations, sources, cities in parallel
    Promise.all([
      supabase.from("products").select("id, name, sku, price, stock_quantity, image_url").eq("is_active", true).order("name"),
      supabase.from("product_variations").select("id, product_id, name, sku, price, stock_quantity, attributes"),
      supabase.from("order_sources").select("id, name").order("sort_order"),
      supabase.from("pathao_cities").select("city_id, city_name").order("city_name"),
    ]).then(([pRes, vRes, sRes, cRes]) => {
      setProducts(pRes.data || []);
      setVariations((vRes.data || []) as VariationRow[]);
      setSources((sRes.data || []) as any[]);
      setCities((cRes.data || []) as any[]);
    });
  }, [open]);

  // Load zones when city changes
  useEffect(() => {
    if (!selectedCity) { setZones([]); setSelectedZone(null); setAreas([]); setSelectedArea(null); return; }
    supabase.from("pathao_zones").select("zone_id, zone_name").eq("city_id", selectedCity).order("zone_name").then(({ data }) => {
      setZones((data || []) as any[]);
      setSelectedZone(null); setAreas([]); setSelectedArea(null);
    });
  }, [selectedCity]);

  // Load areas when zone changes
  useEffect(() => {
    if (!selectedZone) { setAreas([]); setSelectedArea(null); return; }
    supabase.from("pathao_areas").select("area_id, area_name").eq("zone_id", selectedZone).order("area_name").then(({ data }) => {
      setAreas((data || []) as any[]);
      setSelectedArea(null);
    });
  }, [selectedZone]);

  // Auto-detect city/zone/area from address
  useEffect(() => {
    if (!customerAddress || customerAddress.length < 3 || cities.length === 0) return;
    const addr = customerAddress.toLowerCase();
    // Try to match city
    const matchedCity = cities.find(c => addr.includes(c.city_name.toLowerCase()));
    if (matchedCity && matchedCity.city_id !== selectedCity) {
      setSelectedCity(matchedCity.city_id);
    }
  }, [customerAddress, cities]);

  // Build search results including variations
  const searchResults = useMemo((): SearchResult[] => {
    const q = productSearch.toLowerCase();
    if (!q) return [];
    const results: SearchResult[] = [];

    for (const p of products) {
      const productVariations = variations.filter(v => v.product_id === p.id);
      if (productVariations.length > 0) {
        // Show variations instead of parent
        for (const v of productVariations) {
          const varLabel = typeof v.attributes === 'string' ? v.attributes :
            Array.isArray(v.attributes) ? v.attributes.map((a: any) => Object.values(a).join(': ')).join(', ') :
            v.name;
          const matchName = `${p.name} ${varLabel}`.toLowerCase();
          const matchSku = (v.sku || '').toLowerCase();
          if (matchName.includes(q) || matchSku.includes(q) || (p.sku || '').toLowerCase().includes(q)) {
            results.push({
              id: v.id,
              productId: p.id,
              variationId: v.id,
              name: p.name,
              variationLabel: varLabel || v.name,
              sku: v.sku || p.sku,
              price: v.price,
            });
          }
        }
      } else {
        if (p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)) {
          results.push({ id: p.id, productId: p.id, name: p.name, sku: p.sku, price: p.price });
        }
      }
    }
    return results.slice(0, 20);
  }, [products, variations, productSearch]);

  const addItem = (result: SearchResult) => {
    const uid = result.variationId ? `${result.productId}_${result.variationId}` : result.productId;
    setItems(prev => {
      const existing = prev.find(i => i.uid === uid);
      if (existing) return prev.map(i => i.uid === uid ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, {
        uid,
        productId: result.productId,
        variationId: result.variationId,
        name: result.name,
        variationLabel: result.variationLabel,
        price: result.price,
        qty: 1,
      }];
    });
  };

  const updateQty = (uid: string, qty: number) => {
    if (qty <= 0) setItems(prev => prev.filter(i => i.uid !== uid));
    else setItems(prev => prev.map(i => i.uid === uid ? { ...i, qty } : i));
  };

  const removeItem = (uid: string) => setItems(prev => prev.filter(i => i.uid !== uid));

  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const total = subtotal - discount + shippingCost;

  const resetForm = () => {
    setItems([]); setCustomerName(""); setCustomerPhone(""); setCustomerAddress("");
    setFulfillment("delivery"); setSource("phone"); setShippingCost(0); setDiscount(0);
    setNotes(""); setProductSearch("");
    setSelectedCity(null); setSelectedZone(null); setSelectedArea(null);
  };

  const handleCreate = async () => {
    if (items.length === 0) { toast.error("Add at least one product"); return; }
    setSaving(true);
    try {
      let customerId: string | null = null;
      if (customerName || customerPhone) {
        if (customerPhone) {
          const { data: existing } = await supabase.from("customers").select("id").eq("phone", customerPhone).limit(1).single();
          if (existing) {
            customerId = existing.id;
            await supabase.from("customers").update({
              name: customerName || undefined,
              address: customerAddress || undefined,
              city: cities.find(c => c.city_id === selectedCity)?.city_name || undefined,
              zone: zones.find(z => z.zone_id === selectedZone)?.zone_name || undefined,
              area: areas.find(a => a.area_id === selectedArea)?.area_name || undefined,
            }).eq("id", customerId);
          }
        }
        if (!customerId) {
          const { data: newC } = await supabase.from("customers").insert({
            name: customerName || "Customer",
            phone: customerPhone || null,
            address: customerAddress || null,
            city: cities.find(c => c.city_id === selectedCity)?.city_name || null,
            zone: zones.find(z => z.zone_id === selectedZone)?.zone_name || null,
            area: areas.find(a => a.area_id === selectedArea)?.area_name || null,
            source,
          }).select("id").single();
          customerId = newC?.id || null;
        }
      }

      const orderNumber = `ORD-${Date.now().toString(36).toUpperCase()}`;

      const { data: order, error } = await supabase.from("orders").insert({
        order_number: orderNumber,
        source,
        status: "processing",
        payment_status: "unpaid",
        fulfillment_type: fulfillment,
        customer_id: customerId,
        subtotal,
        discount,
        shipping_cost: shippingCost,
        total,
        notes: notes || null,
        pathao_recipient_city: selectedCity,
        pathao_recipient_zone: selectedZone,
        pathao_recipient_area: selectedArea,
      }).select("id").single();

      if (error) throw error;

      const orderItems = items.map(i => ({
        order_id: order.id,
        product_id: i.productId,
        product_name: i.variationLabel ? `${i.name} - ${i.variationLabel}` : i.name,
        unit_price: i.price,
        quantity: i.qty,
        line_total: i.price * i.qty,
      }));
      await supabase.from("order_items").insert(orderItems);

      await supabase.from("order_timeline").insert({
        order_id: order.id,
        event: "created",
        description: `Order created manually (${source})`,
      });

      toast.success(`Order ${orderNumber} created`);
      resetForm();
      onOpenChange(false);
      onCreated();
    } catch (err: any) {
      toast.error(err.message || "Failed to create order");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Add New Order</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {/* Product Search */}
          <div>
            <Label className="text-xs font-medium">Search Products</Label>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="Search by name, SKU, or variation..." className="pl-9" />
            </div>
            {productSearch && (
              <ScrollArea className="mt-2 max-h-48 rounded-md border border-border">
                {searchResults.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground text-center">No products found</div>
                ) : (
                  searchResults.map(r => (
                    <button
                      key={r.id}
                      onClick={() => { addItem(r); setProductSearch(""); }}
                      className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-accent text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{r.name}</span>
                        {r.variationLabel && <Badge variant="secondary" className="text-xs">{r.variationLabel}</Badge>}
                        {r.sku && <span className="text-xs text-muted-foreground">{r.sku}</span>}
                      </div>
                      <span className="text-muted-foreground">৳{r.price.toLocaleString()}</span>
                    </button>
                  ))
                )}
              </ScrollArea>
            )}
          </div>

          {/* Cart Items */}
          {items.length > 0 && (
            <div className="rounded-md border border-border">
              <div className="px-3 py-2 bg-secondary text-xs font-medium text-muted-foreground grid grid-cols-[1fr_80px_100px_80px_32px]">
                <span>Product</span><span className="text-right">Price</span><span className="text-center">Qty</span><span className="text-right">Total</span><span></span>
              </div>
              {items.map(item => (
                <div key={item.uid} className="px-3 py-2 border-t border-border grid grid-cols-[1fr_80px_100px_80px_32px] items-center text-sm">
                  <div className="truncate">
                    <span className="font-medium">{item.name}</span>
                    {item.variationLabel && <span className="ml-1 text-xs text-muted-foreground">({item.variationLabel})</span>}
                  </div>
                  <span className="text-right text-muted-foreground">৳{item.price.toLocaleString()}</span>
                  <div className="flex items-center justify-center gap-1">
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => updateQty(item.uid, item.qty - 1)}><Minus className="h-3 w-3" /></Button>
                    <span className="w-6 text-center">{item.qty}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => updateQty(item.uid, item.qty + 1)}><Plus className="h-3 w-3" /></Button>
                  </div>
                  <span className="text-right font-medium">৳{(item.price * item.qty).toLocaleString()}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeItem(item.uid)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                </div>
              ))}
            </div>
          )}

          <Separator />

          {/* Customer & Fulfillment */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Customer Name</Label>
              <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Customer name" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Phone</Label>
              <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="01XXXXXXXXX" />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label className="text-xs">Address</Label>
              <Input value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} placeholder="Full delivery address..." />
            </div>
          </div>

          {/* Pathao Location */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">City</Label>
              <Select value={selectedCity?.toString() || ""} onValueChange={(v) => setSelectedCity(Number(v))}>
                <SelectTrigger><SelectValue placeholder="Select city" /></SelectTrigger>
                <SelectContent>
                  {cities.map(c => <SelectItem key={c.city_id} value={c.city_id.toString()}>{c.city_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Zone</Label>
              <Select value={selectedZone?.toString() || ""} onValueChange={(v) => setSelectedZone(Number(v))} disabled={!selectedCity}>
                <SelectTrigger><SelectValue placeholder="Select zone" /></SelectTrigger>
                <SelectContent>
                  {zones.map(z => <SelectItem key={z.zone_id} value={z.zone_id.toString()}>{z.zone_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Area</Label>
              <Select value={selectedArea?.toString() || ""} onValueChange={(v) => setSelectedArea(Number(v))} disabled={!selectedZone}>
                <SelectTrigger><SelectValue placeholder="Select area" /></SelectTrigger>
                <SelectContent>
                  {areas.map(a => <SelectItem key={a.area_id} value={a.area_id.toString()}>{a.area_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Delivery Method</Label>
              <Select value={fulfillment} onValueChange={(v: any) => setFulfillment(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="delivery">Delivery</SelectItem>
                  <SelectItem value="pickup">Pickup</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Source</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {sources.map(s => <SelectItem key={s.id} value={s.name}>{s.name.charAt(0).toUpperCase() + s.name.slice(1)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Shipping Cost</Label>
              <Input type="number" value={shippingCost} onChange={(e) => setShippingCost(Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Discount</Label>
              <Input type="number" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>

          {/* Totals */}
          <div className="rounded-md border border-border p-3 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>৳{subtotal.toLocaleString()}</span></div>
            {discount > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="text-destructive">-৳{discount.toLocaleString()}</span></div>}
            {shippingCost > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Shipping</span><span>৳{shippingCost.toLocaleString()}</span></div>}
            <Separator />
            <div className="flex justify-between font-semibold text-base"><span>Total</span><span>৳{total.toLocaleString()}</span></div>
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => { resetForm(); onOpenChange(false); }}>Cancel</Button>
          <Button onClick={handleCreate} disabled={saving || items.length === 0}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
