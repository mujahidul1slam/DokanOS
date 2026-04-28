import { useState, useEffect, useMemo } from "react";
import Fuse from "fuse.js";
import { Search, Plus, Minus, Trash2, Loader2, Ruler, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { logAction } from "@/lib/auditLog";
import { addOrderTimeline } from "@/lib/orderTimeline";
import { Switch } from "@/components/ui/switch";
import {
  getGroupsForProduct,
  saveOrderItemMeasurements,
  type MeasurementGroup,
  type CapturedMeasurement,
} from "@/lib/measurements";

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
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

const normalizeBdPhone = (raw?: string | null) => {
  if (!raw) return null;
  let p = String(raw).replace(/\D/g, "");
  if (!p) return null;
  if (p.startsWith("880") && p.length >= 13) p = p.slice(3);
  if (p.length === 10 && p.startsWith("1")) p = `0${p}`;
  return p;
};

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
  customMeasurements?: boolean;
  // groupId -> { fieldId -> value }
  measurementValues?: Record<string, Record<string, string>>;
  measurementNotes?: Record<string, string>;
  measurementsExpanded?: boolean;
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
  const [fulfillment, setFulfillment] = useState<"walkin" | "pickup" | "delivery">("delivery");
  const [source, setSource] = useState("phone");
  const [sources, setSources] = useState<{ id: string; name: string }[]>([]);
  const [shippingCost, setShippingCost] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // AI parse-from-text
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiParsing, setAiParsing] = useState(false);

  // Custom measurements
  const [measurementsEnabled, setMeasurementsEnabled] = useState(true);
  // Cache: productId -> MeasurementGroup[]
  const [groupsByProduct, setGroupsByProduct] = useState<Record<string, MeasurementGroup[]>>({});

  // Pathao location
  const [cities, setCities] = useState<{ city_id: number; city_name: string }[]>([]);
  const [zones, setZones] = useState<{ zone_id: number; zone_name: string }[]>([]);
  const [areas, setAreas] = useState<{ area_id: number; area_name: string }[]>([]);
  const [allZones, setAllZones] = useState<{ zone_id: number; zone_name: string; city_id: number }[]>([]);
  const [allAreas, setAllAreas] = useState<{ area_id: number; area_name: string; zone_id: number }[]>([]);
  const [selectedCity, setSelectedCity] = useState<number | null>(null);
  const [selectedZone, setSelectedZone] = useState<number | null>(null);
  const [selectedArea, setSelectedArea] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      supabase.from("products").select("id, name, sku, price, stock_quantity, image_url").eq("is_active", true).order("name"),
      supabase.from("product_variations").select("id, product_id, name, sku, price, stock_quantity, attributes"),
      supabase.from("order_sources").select("id, name").order("sort_order"),
      supabase.from("pathao_cities").select("city_id, city_name").order("city_name"),
      supabase.from("pathao_zones").select("zone_id, zone_name, city_id"),
      supabase.from("pathao_areas").select("area_id, area_name, zone_id"),
      supabase.from("invoice_settings" as any).select("pos_custom_measurements_enabled").limit(1).maybeSingle(),
    ]).then(([pRes, vRes, sRes, cRes, zRes, aRes, isRes]) => {
      setProducts(pRes.data || []);
      setVariations((vRes.data || []) as VariationRow[]);
      setSources((sRes.data || []) as any[]);
      setCities((cRes.data || []) as any[]);
      setAllZones((zRes.data || []) as any[]);
      setAllAreas((aRes.data || []) as any[]);
      setMeasurementsEnabled(((isRes as any).data?.pos_custom_measurements_enabled) !== false);
    });
  }, [open]);

  // When a new product is added to the cart, lazy-load its measurement groups.
  useEffect(() => {
    const productIds = Array.from(new Set(items.map((i) => i.productId)));
    const missing = productIds.filter((id) => !(id in groupsByProduct));
    if (missing.length === 0) return;
    let mounted = true;
    (async () => {
      const entries = await Promise.all(
        missing.map(async (pid) => [pid, await getGroupsForProduct(pid)] as const),
      );
      if (!mounted) return;
      setGroupsByProduct((prev) => {
        const next = { ...prev };
        for (const [pid, grps] of entries) next[pid] = grps;
        return next;
      });
    })();
    return () => { mounted = false; };
  }, [items, groupsByProduct]);

  // When city changes, derive its zones (from the global cache)
  useEffect(() => {
    if (!selectedCity) { setZones([]); return; }
    setZones(allZones.filter((z) => z.city_id === selectedCity));
  }, [selectedCity, allZones]);

  // When zone changes, derive its areas (from the global cache)
  useEffect(() => {
    if (!selectedZone) { setAreas([]); return; }
    setAreas(allAreas.filter((a) => a.zone_id === selectedZone));
  }, [selectedZone, allAreas]);

  // Address auto-detect: try to match an AREA first (most specific) — that
  // back-fills its zone and city. Otherwise match a ZONE which back-fills
  // its city. Otherwise just match the city.
  useEffect(() => {
    if (!customerAddress || customerAddress.length < 3) return;
    if (allZones.length === 0 && cities.length === 0) return;
    let mounted = true;
    (async () => {
      const { buildAddressCandidates, strictMatch, fuzzyMatch } = await import("@/lib/pathaoMatch");
      if (!mounted) return;
      const candidates = buildAddressCandidates([customerAddress]);

      let nextCity = selectedCity;
      let nextZone = selectedZone;
      let nextArea = selectedArea;

      const areaMatch = strictMatch(allAreas, (a) => a.area_name, candidates);
      if (areaMatch) {
        nextArea = areaMatch.area_id;
        nextZone = areaMatch.zone_id;
        const parent = allZones.find((z) => z.zone_id === areaMatch.zone_id);
        if (parent) nextCity = parent.city_id;
      } else {
        const zoneMatch =
          strictMatch(allZones, (z) => z.zone_name, candidates) ||
          fuzzyMatch(allZones, (z) => z.zone_name, candidates);
        if (zoneMatch) {
          nextZone = zoneMatch.zone_id;
          nextCity = zoneMatch.city_id;
        } else {
          const cityMatch = strictMatch(cities, (c) => c.city_name, candidates);
          if (cityMatch) nextCity = cityMatch.city_id;
        }
      }

      if (nextCity !== selectedCity) setSelectedCity(nextCity);
      if (nextZone !== selectedZone) setSelectedZone(nextZone);
      if (nextArea !== selectedArea) setSelectedArea(nextArea);
    })();
    return () => { mounted = false; };
  }, [customerAddress, cities, allZones, allAreas]);

  // Flat searchable index of products + variations
  const searchIndex = useMemo((): (SearchResult & { searchText: string })[] => {
    const flat: (SearchResult & { searchText: string })[] = [];
    for (const p of products) {
      const productVariations = variations.filter((v) => v.product_id === p.id);
      if (productVariations.length > 0) {
        for (const v of productVariations) {
          const varLabel =
            typeof v.attributes === "string"
              ? v.attributes
              : Array.isArray(v.attributes)
              ? v.attributes.map((a: any) => Object.values(a).join(": ")).join(", ")
              : v.name;
          flat.push({
            id: v.id,
            productId: p.id,
            variationId: v.id,
            name: p.name,
            variationLabel: varLabel || v.name,
            sku: v.sku || p.sku,
            price: v.price,
            searchText: `${p.name} ${varLabel} ${v.sku || ""} ${p.sku || ""}`,
          });
        }
      } else {
        flat.push({
          id: p.id,
          productId: p.id,
          name: p.name,
          sku: p.sku,
          price: p.price,
          searchText: `${p.name} ${p.sku || ""}`,
        });
      }
    }
    return flat;
  }, [products, variations]);

  const fuse = useMemo(
    () =>
      new Fuse(searchIndex, {
        keys: [
          { name: "name", weight: 0.45 },
          { name: "variationLabel", weight: 0.2 },
          { name: "sku", weight: 0.2 },
          { name: "searchText", weight: 0.15 },
        ],
        threshold: 0.4,
        ignoreLocation: true,
        minMatchCharLength: 2,
      }),
    [searchIndex],
  );

  const searchResults = useMemo((): SearchResult[] => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return [];
    // Exact SKU match wins
    const exact = searchIndex.filter((r) => (r.sku || "").toLowerCase() === q);
    if (exact.length > 0) return exact.slice(0, 20);
    return fuse.search(q).slice(0, 20).map((r) => r.item);
  }, [searchIndex, fuse, productSearch]);

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

  const updateItem = (uid: string, patch: Partial<OrderItem>) =>
    setItems(prev => prev.map(i => i.uid === uid ? { ...i, ...patch } : i));

  const setMeasurementValue = (uid: string, groupId: string, fieldId: string, value: string) =>
    setItems(prev => prev.map(i => {
      if (i.uid !== uid) return i;
      const next = { ...(i.measurementValues || {}) };
      next[groupId] = { ...(next[groupId] || {}), [fieldId]: value };
      return { ...i, measurementValues: next };
    }));

  const setMeasurementNote = (uid: string, groupId: string, value: string) =>
    setItems(prev => prev.map(i => {
      if (i.uid !== uid) return i;
      const next = { ...(i.measurementNotes || {}), [groupId]: value };
      return { ...i, measurementNotes: next };
    }));

  const buildItemMeasurements = (item: OrderItem): CapturedMeasurement[] => {
    if (!item.customMeasurements) return [];
    const groups = groupsByProduct[item.productId] || [];
    return groups
      .map<CapturedMeasurement | null>((g) => {
        const vals = item.measurementValues?.[g.id] || {};
        const filled = g.fields
          .map((f) => ({ name: f.name, value: vals[f.id] || "" }))
          .filter((v) => v.value.trim() !== "");
        const note = item.measurementNotes?.[g.id]?.trim();
        if (filled.length === 0 && !note) return null;
        return {
          groupId: g.id,
          groupName: g.name,
          displayFormat: g.display_format,
          unit: g.unit,
          values: filled,
          notes: note || undefined,
          source: "pos",
        };
      })
      .filter((x): x is CapturedMeasurement => x !== null);
  };

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
        const normalizedCustomerPhone = normalizeBdPhone(customerPhone);
        if (customerName || normalizedCustomerPhone) {
          if (normalizedCustomerPhone) {
            const { data: existing } = await supabase.from("customers").select("id").eq("phone", normalizedCustomerPhone).limit(1).maybeSingle();
            if (existing) {
              customerId = existing.id;
              await supabase.from("customers").update({
                name: customerName || undefined,
                phone: normalizedCustomerPhone,
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
              phone: normalizedCustomerPhone,
              address: customerAddress || null,
              city: cities.find(c => c.city_id === selectedCity)?.city_name || null,
              zone: zones.find(z => z.zone_id === selectedZone)?.zone_name || null,
              area: areas.find(a => a.area_id === selectedArea)?.area_name || null,
              source,
            }).select("id").single();
            customerId = newC?.id || null;
          }
        }

        const { data: genNum } = await supabase.rpc("generate_pos_order_number" as any, { p_store_id: null, p_source: "manual" });
        const orderNumber = (genNum as string) || `ORD-${Date.now().toString(36).toUpperCase()}`;

        const { data: order, error } = await supabase.from("orders").insert({
          order_number: orderNumber,
          source,
          status: "processing",
          payment_status: "unpaid",
          fulfillment_type: fulfillment,
          customer_id: customerId,
          customer_name: customerName || null,
          customer_phone: normalizedCustomerPhone,
          customer_address: customerAddress || null,
          customer_city: cities.find(c => c.city_id === selectedCity)?.city_name || null,
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

      const orderItemsPayload = items.map(i => ({
        order_id: order.id,
        product_id: i.productId,
        product_name: i.variationLabel ? `${i.name} - ${i.variationLabel}` : i.name,
        unit_price: i.price,
        quantity: i.qty,
        line_total: i.price * i.qty,
      }));
      const { data: insertedItems } = await supabase
        .from("order_items")
        .insert(orderItemsPayload)
        .select("id, product_id, product_name");

      // Persist captured measurements per inserted order item
      if (insertedItems && insertedItems.length > 0) {
        const used = new Set<string>();
        for (const cartItem of items) {
          const captured = buildItemMeasurements(cartItem);
          if (captured.length === 0) continue;
          const expectedName = cartItem.variationLabel
            ? `${cartItem.name} - ${cartItem.variationLabel}`
            : cartItem.name;
          const match = insertedItems.find(
            (oi: any) =>
              !used.has(oi.id) &&
              oi.product_id === cartItem.productId &&
              oi.product_name === expectedName,
          );
          if (!match) continue;
          used.add(match.id);
          await saveOrderItemMeasurements(order.id, match.id, captured);
        }
      }

      await addOrderTimeline({
        order_id: order.id,
        event: "created",
        description: `Order placed manually (${source})`,
        metadata: { order_number: orderNumber, source },
      });

      await logAction("create", "order", order.id, {
        order_number: orderNumber, source,
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
              {items.map(item => {
                const groups = groupsByProduct[item.productId] || [];
                const showMeasureToggle = measurementsEnabled && groups.length > 0;
                return (
                  <div key={item.uid} className="border-t border-border">
                    <div className="px-3 py-2 grid grid-cols-[1fr_80px_100px_80px_32px] items-center text-sm">
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

                    {showMeasureToggle && (
                      <div className="px-3 pb-2 space-y-2">
                        <div className="flex items-center justify-between rounded-md bg-secondary/50 px-2.5 py-1.5">
                          <div className="flex items-center gap-2">
                            <Ruler className="h-3.5 w-3.5 text-primary" />
                            <span className="text-xs font-medium">Custom Measurements</span>
                            <span className="text-[10px] text-muted-foreground">
                              {groups.length === 1 ? groups[0].name : `${groups.length} groups`}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {item.customMeasurements && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => updateItem(item.uid, { measurementsExpanded: !item.measurementsExpanded })}
                              >
                                {item.measurementsExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                              </Button>
                            )}
                            <Switch
                              checked={!!item.customMeasurements}
                              onCheckedChange={(checked) =>
                                updateItem(item.uid, { customMeasurements: checked, measurementsExpanded: checked })
                              }
                            />
                          </div>
                        </div>

                        {item.customMeasurements && item.measurementsExpanded && (
                          <div className="space-y-2">
                            {groups.map((g) => (
                              <div key={g.id} className="rounded-md border border-border bg-card p-2.5 space-y-2">
                                <div className="flex items-center justify-between">
                                  <h5 className="text-xs font-semibold">{g.name}</h5>
                                  <span className="text-[10px] text-muted-foreground uppercase">{g.unit}</span>
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                  {g.fields.map((f) => (
                                    <div key={f.id}>
                                      <Label className="text-[10px] text-muted-foreground">{f.name}</Label>
                                      <Input
                                        value={item.measurementValues?.[g.id]?.[f.id] || ""}
                                        onChange={(e) => setMeasurementValue(item.uid, g.id, f.id, e.target.value)}
                                        placeholder="0.0"
                                        className="h-8 mt-0.5 text-xs"
                                      />
                                    </div>
                                  ))}
                                </div>
                                <div>
                                  <Label className="text-[10px] text-muted-foreground">Notes</Label>
                                  <Textarea
                                    value={item.measurementNotes?.[g.id] || ""}
                                    onChange={(e) => setMeasurementNote(item.uid, g.id, e.target.value)}
                                    placeholder="Special instructions..."
                                    className="mt-0.5 min-h-[40px] text-xs"
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
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
              <SearchableSelect
                options={cities.map((c) => ({ value: c.city_id.toString(), label: c.city_name }))}
                value={selectedCity?.toString() || ""}
                onChange={(v) => setSelectedCity(v ? Number(v) : null)}
                placeholder="Select city"
                searchPlaceholder="Search cities..."
                emptyText="No city found"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Zone</Label>
              <SearchableSelect
                options={zones.map((z) => ({ value: z.zone_id.toString(), label: z.zone_name }))}
                value={selectedZone?.toString() || ""}
                onChange={(v) => setSelectedZone(v ? Number(v) : null)}
                placeholder="Select zone"
                searchPlaceholder="Search zones..."
                emptyText="No zone found"
                disabled={!selectedCity}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Area</Label>
              <SearchableSelect
                options={areas.map((a) => ({ value: a.area_id.toString(), label: a.area_name }))}
                value={selectedArea?.toString() || ""}
                onChange={(v) => setSelectedArea(v ? Number(v) : null)}
                placeholder="Select area"
                searchPlaceholder="Search areas..."
                emptyText="No area found"
                disabled={!selectedZone}
              />
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
                  <SelectItem value="walkin">Walk-in</SelectItem>
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
