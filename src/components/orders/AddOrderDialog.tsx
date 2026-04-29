import { useState, useEffect, useMemo } from "react";
import Fuse from "fuse.js";
import { Search, Plus, Minus, Trash2, Loader2, Ruler, ChevronDown, ChevronUp, Sparkles, ImageIcon } from "lucide-react";
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

import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
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
  isCustomItem?: boolean;
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
  const [sources, setSources] = useState<{ id: string; name: string; is_default?: boolean }[]>([]);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [storeId, setStoreId] = useState<string>("");

  // Custom item dialog
  const [customItemOpen, setCustomItemOpen] = useState(false);
  const [customItemName, setCustomItemName] = useState("");
  const [customItemPrice, setCustomItemPrice] = useState("");
  const [customItemQty, setCustomItemQty] = useState("1");
  const [shippingCost, setShippingCost] = useState(0);
  const [shippingInsideDhaka, setShippingInsideDhaka] = useState(80);
  const [shippingOutsideDhaka, setShippingOutsideDhaka] = useState(150);
  const [shippingTouched, setShippingTouched] = useState(false);
  const [discount, setDiscount] = useState(0);
  const [paidAmount, setPaidAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // AI parse-from-text
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
      supabase.from("order_sources").select("id, name, is_default").order("sort_order"),
      supabase.from("pathao_cities").select("city_id, city_name").order("city_name"),
      supabase.from("pathao_zones").select("zone_id, zone_name, city_id"),
      supabase.from("pathao_areas").select("area_id, area_name, zone_id"),
      supabase.from("invoice_settings" as any).select("pos_custom_measurements_enabled, shipping_inside_dhaka, shipping_outside_dhaka").limit(1).maybeSingle(),
      supabase.from("stores").select("id, name").order("name"),
    ]).then(([pRes, vRes, sRes, cRes, zRes, aRes, isRes, stRes]) => {
      setProducts(pRes.data || []);
      setVariations((vRes.data || []) as VariationRow[]);
      const srcs = (sRes.data || []) as any[];
      setSources(srcs);
      const def = srcs.find((s) => s.is_default);
      if (def) setSource(def.name);
      setCities((cRes.data || []) as any[]);
      setAllZones((zRes.data || []) as any[]);
      setAllAreas((aRes.data || []) as any[]);
      const isData: any = (isRes as any).data;
      setMeasurementsEnabled(isData?.pos_custom_measurements_enabled !== false);
      if (isData?.shipping_inside_dhaka != null) setShippingInsideDhaka(Number(isData.shipping_inside_dhaka));
      if (isData?.shipping_outside_dhaka != null) setShippingOutsideDhaka(Number(isData.shipping_outside_dhaka));
      setStores((stRes.data || []) as any[]);
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

  // Auto-fill shipping cost based on city (Inside vs Outside Dhaka).
  // Only applies when the user hasn't manually edited the field.
  useEffect(() => {
    if (shippingTouched) return;
    if (!selectedCity || cities.length === 0) return;
    const cityName = cities.find((c) => c.city_id === selectedCity)?.city_name || "";
    const isDhaka = cityName.trim().toLowerCase() === "dhaka";
    setShippingCost(isDhaka ? shippingInsideDhaka : shippingOutsideDhaka);
  }, [selectedCity, cities, shippingInsideDhaka, shippingOutsideDhaka, shippingTouched]);

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
        includeScore: true,
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

  const addCustomItem = () => {
    const name = customItemName.trim();
    const price = Number(customItemPrice);
    const qty = Math.max(1, Number(customItemQty) || 1);
    if (!name) { toast.error("Enter a name"); return; }
    if (!Number.isFinite(price) || price < 0) { toast.error("Enter a valid price"); return; }
    const uid = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setItems(prev => [...prev, {
      uid,
      productId: "",
      name,
      price,
      qty,
      isCustomItem: true,
    }]);
    setCustomItemName(""); setCustomItemPrice(""); setCustomItemQty("1");
    setCustomItemOpen(false);
  };

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
    setFulfillment("delivery");
    const def = sources.find((s) => (s as any).is_default);
    setSource(def ? def.name : "phone");
    setShippingCost(0); setShippingTouched(false);
    setDiscount(0);
    setPaidAmount(0);
    setPaymentMethod("cash");
    setNotes(""); setProductSearch("");
    setSelectedCity(null); setSelectedZone(null); setSelectedArea(null);
    setAiText("");
    setStoreId("");
  };

  const fileToDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  // Downscale large screenshots before sending to keep the request small.
  const downscaleImage = async (dataUrl: string, maxDim = 1600): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        if (scale === 1) return resolve(dataUrl);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(dataUrl);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  };

  const runAiParse = async (payload: { text?: string; image?: string }) => {
    setAiParsing(true);
    try {
      const { data, error } = await supabase.functions.invoke("parse-order-text", { body: payload });
      if (error) throw error;
      const p = (data as any)?.parsed;
      if (!p) { toast.error("Couldn't extract any details"); return; }

      const filled: string[] = [];
      if (p.name) { setCustomerName(p.name); filled.push("name"); }
      if (p.phone) {
        const norm = normalizeBdPhone(p.phone) || p.phone;
        setCustomerPhone(norm);
        filled.push("phone");
      }
      const addrParts = [p.address, p.area, p.zone, p.city].filter(Boolean);
      if (addrParts.length > 0) { setCustomerAddress(addrParts.join(", ")); filled.push("address"); }
      if (typeof p.shipping_cost === "number") { setShippingCost(p.shipping_cost); setShippingTouched(true); filled.push("shipping"); }
      if (typeof p.discount === "number") { setDiscount(p.discount); filled.push("discount"); }
      if (p.notes) {
        setNotes((prev) => prev ? `${prev}\n${p.notes}` : p.notes);
        filled.push("notes");
      }
      if (typeof p.due_amount === "number") {
        const dueLine = `Due: ৳${p.due_amount.toLocaleString()}`;
        setNotes((prev) => prev ? `${prev}\n${dueLine}` : dueLine);
        filled.push("due");
      }

      let productsAdded = 0;
      let productsSkipped = 0;
      const hints: string[] = Array.isArray(p.product_hints) ? p.product_hints : [];
      for (const hint of hints) {
        const q = hint.trim();
        if (q.length < 2) continue;
        const qLower = q.toLowerCase();

        // 1. Exact SKU match always wins
        const exact = searchIndex.find((r) => (r.sku || "").toLowerCase() === qLower);
        if (exact) { addItem(exact); productsAdded += 1; continue; }

        // 2. Fuzzy match: require a strong score AND a shared meaningful token
        // between the hint and the matched product name. Fuse score: 0 = perfect, 1 = no match.
        const top = fuse.search(q)[0];
        if (!top || (top.score ?? 1) > 0.25) { productsSkipped += 1; continue; }

        const candidateText = `${top.item.name} ${top.item.variationLabel || ""} ${top.item.sku || ""}`.toLowerCase();
        const hintTokens = qLower.split(/[\s,./-]+/).filter((t) => t.length >= 3);
        const sharesToken = hintTokens.length === 0
          ? false
          : hintTokens.some((t) => candidateText.includes(t));

        if (sharesToken) { addItem(top.item); productsAdded += 1; }
        else { productsSkipped += 1; }
      }

      if (filled.length === 0 && productsAdded === 0) {
        toast.warning(
          productsSkipped > 0
            ? `No matching products found in catalog — add them manually`
            : "AI couldn't find any usable info"
        );
      } else {
        const bits: string[] = [];
        if (filled.length) bits.push(filled.join(", "));
        if (productsAdded) bits.push(`${productsAdded} product${productsAdded === 1 ? "" : "s"}`);
        toast.success(`Filled: ${bits.join(" + ")}`);
        if (productsSkipped > 0) {
          toast.info(`Skipped ${productsSkipped} unmatched product${productsSkipped === 1 ? "" : "s"} — add manually if needed`);
        }
        if (payload.text) setAiText("");
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to parse");
    } finally {
      setAiParsing(false);
    }
  };

  const handleAiParse = async () => {
    const text = aiText.trim();
    if (text.length < 5) { toast.error("Paste a longer message to parse"); return; }
    await runAiParse({ text });
  };

  const handleAiParseImage = async (file: File) => {
    if (!file.type.startsWith("image/")) { toast.error("Please select an image"); return; }
    if (file.size > 8 * 1024 * 1024) { toast.error("Image too large (max 8MB)"); return; }
    try {
      const raw = await fileToDataUrl(file);
      const image = await downscaleImage(raw);
      const text = aiText.trim();
      await runAiParse({ image, text: text.length >= 5 ? text : undefined });
    } catch (err: any) {
      toast.error(err?.message || "Failed to read image");
    }
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

        const { data: genNum } = await supabase.rpc("generate_pos_order_number" as any, { p_store_id: storeId || null, p_source: "manual" });
        const orderNumber = (genNum as string) || `ORD-${Date.now().toString(36).toUpperCase()}`;

        const paymentStatus =
          paidAmount <= 0 ? "unpaid" : paidAmount >= total ? "paid" : "partial";

        const { data: order, error } = await supabase.from("orders").insert({
          order_number: orderNumber,
          source,
          status: "processing",
          payment_status: paymentStatus,
          payment_method: paidAmount > 0 ? paymentMethod : null,
          fulfillment_type: fulfillment,
          customer_id: customerId,
          customer_name: customerName || null,
          customer_phone: normalizedCustomerPhone,
          customer_address: customerAddress || null,
          customer_city: cities.find(c => c.city_id === selectedCity)?.city_name || null,
          store_id: storeId || null,
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
        product_id: i.isCustomItem || !i.productId ? null : i.productId,
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

      if (paidAmount > 0) {
        await supabase.from("order_payments").insert({
          order_id: order.id,
          method: paymentMethod,
          amount: paidAmount,
        });
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
    <>
    <ResponsiveDialog
      open={open}
      onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}
      title="Add New Order"
      footer={
        <>
          <Button variant="outline" onClick={() => { resetForm(); onOpenChange(false); }}>Cancel</Button>
          <Button onClick={handleCreate} disabled={saving || items.length === 0}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Order
          </Button>
        </>
      }
    >
      <div className="space-y-4">
          {/* AI parse-from-text — always visible */}
          <div className="rounded-md border border-dashed border-primary/40 bg-primary/5 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Paste customer message — AI fills the form</span>
            </div>
            <Textarea
              value={aiText}
              onChange={(e) => setAiText(e.target.value)}
              onPaste={(e) => {
                const items = e.clipboardData?.items;
                if (!items) return;
                for (let i = 0; i < items.length; i++) {
                  const it = items[i];
                  if (it.kind === "file" && it.type.startsWith("image/")) {
                    const file = it.getAsFile();
                    if (file) {
                      e.preventDefault();
                      toast.info("Screenshot pasted — parsing…");
                      handleAiParseImage(file);
                      return;
                    }
                  }
                }
              }}
              placeholder={"Paste anything — e.g.\nName: Rahim\n01712345678\nHouse 12, Road 5, Mirpur 10, Dhaka\n2pcs blue panjabi size L\nShipping 80, due 1200\n\n📋 Tip: paste a screenshot directly here (Ctrl/Cmd+V)"}
              rows={4}
              className="text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              Tip: paste a screenshot directly (Ctrl/Cmd+V) or upload one below.
            </p>
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={aiParsing}
                onClick={() => document.getElementById("ai-screenshot-input")?.click()}
              >
                <ImageIcon className="h-3.5 w-3.5 mr-1.5" />
                Upload screenshot
              </Button>
              <input
                id="ai-screenshot-input"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleAiParseImage(f);
                  e.target.value = "";
                }}
              />
              <Button type="button" size="sm" onClick={handleAiParse} disabled={aiParsing || aiText.trim().length < 5}>
                {aiParsing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
                Parse with AI
              </Button>
            </div>
          </div>

          {/* Product Search */}
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">Search Products</Label>
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setCustomItemOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add custom item
              </Button>
            </div>
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
              <div className="hidden sm:grid px-3 py-2 bg-secondary text-xs font-medium text-muted-foreground grid-cols-[1fr_80px_100px_80px_32px]">
                <span>Product</span><span className="text-right">Price</span><span className="text-center">Qty</span><span className="text-right">Total</span><span></span>
              </div>
              {items.map(item => {
                const groups = groupsByProduct[item.productId] || [];
                const showMeasureToggle = measurementsEnabled && groups.length > 0;
                return (
                  <div key={item.uid} className="border-t border-border">
                    {/* Desktop: single-row grid */}
                    <div className="hidden sm:grid px-3 py-2 grid-cols-[1fr_80px_100px_80px_32px] items-center text-sm">
                      <div className="truncate">
                        <span className="font-medium">{item.name}</span>
                        {item.variationLabel && <span className="ml-1 text-xs text-muted-foreground">({item.variationLabel})</span>}
                      </div>
                      <span className="text-right text-muted-foreground">৳{item.price.toLocaleString()}</span>
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => updateQty(item.uid, item.qty - 1)}><Minus className="h-3.5 w-3.5" /></Button>
                        <span className="w-6 text-center">{item.qty}</span>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => updateQty(item.uid, item.qty + 1)}><Plus className="h-3.5 w-3.5" /></Button>
                      </div>
                      <span className="text-right font-medium">৳{(item.price * item.qty).toLocaleString()}</span>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeItem(item.uid)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                    </div>
                    {/* Mobile: stacked card */}
                    <div className="sm:hidden px-3 py-2.5 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium leading-tight">{item.name}</div>
                          {item.variationLabel && <div className="text-xs text-muted-foreground mt-0.5">{item.variationLabel}</div>}
                          <div className="text-xs text-muted-foreground mt-1">৳{item.price.toLocaleString()} each</div>
                        </div>
                        <Button variant="ghost" size="icon" className="h-9 w-9 -mr-1 shrink-0" onClick={() => removeItem(item.uid)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 rounded-md border border-border">
                          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => updateQty(item.uid, item.qty - 1)}><Minus className="h-4 w-4" /></Button>
                          <span className="w-8 text-center text-sm font-medium">{item.qty}</span>
                          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => updateQty(item.uid, item.qty + 1)}><Plus className="h-4 w-4" /></Button>
                        </div>
                        <span className="text-sm font-semibold">৳{(item.price * item.qty).toLocaleString()}</span>
                      </div>
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

          {/* Store */}
          {stores.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Store</Label>
              <Select value={storeId || "__none__"} onValueChange={(v) => setStoreId(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Select store" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No store</SelectItem>
                  {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Customer & Fulfillment */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Customer Name</Label>
              <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Customer name" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Phone</Label>
              <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="01XXXXXXXXX" type="tel" inputMode="tel" autoComplete="tel" />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label className="text-xs">Address</Label>
              <Input value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} placeholder="Full delivery address..." />
            </div>
          </div>

          {/* Pathao Location */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
              <Input
                type="number"
                inputMode="numeric"
                value={shippingCost}
                onChange={(e) => { setShippingCost(Number(e.target.value)); setShippingTouched(true); }}
              />
              <div className="flex gap-1 pt-0.5">
                <Button
                  type="button"
                  variant={shippingCost === shippingInsideDhaka ? "secondary" : "outline"}
                  size="sm"
                  className="h-6 px-2 text-[10px] flex-1"
                  onClick={() => { setShippingCost(shippingInsideDhaka); setShippingTouched(true); }}
                  title="Inside Dhaka"
                >
                  In ৳{shippingInsideDhaka}
                </Button>
                <Button
                  type="button"
                  variant={shippingCost === shippingOutsideDhaka ? "secondary" : "outline"}
                  size="sm"
                  className="h-6 px-2 text-[10px] flex-1"
                  onClick={() => { setShippingCost(shippingOutsideDhaka); setShippingTouched(true); }}
                  title="Outside Dhaka"
                >
                  Out ৳{shippingOutsideDhaka}
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Discount</Label>
              <Input type="number" inputMode="numeric" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} />
            </div>
          </div>

          {/* Payment */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Paid Amount</Label>
              <Input
                type="number"
                inputMode="numeric"
                value={paidAmount}
                onChange={(e) => setPaidAmount(Number(e.target.value))}
                placeholder="0"
              />
              <div className="flex gap-1 pt-0.5">
                <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[10px] flex-1"
                  onClick={() => setPaidAmount(total)}>
                  Full ৳{total.toLocaleString()}
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[10px] flex-1"
                  onClick={() => setPaidAmount(0)}>
                  Clear
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Payment Method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod} disabled={paidAmount <= 0}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="bkash">bKash</SelectItem>
                  <SelectItem value="nagad">Nagad</SelectItem>
                  <SelectItem value="rocket">Rocket</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="bank">Bank Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Due</Label>
              <div className="h-10 flex items-center px-3 rounded-md border border-border bg-secondary/40 text-sm font-medium">
                ৳{Math.max(0, total - paidAmount).toLocaleString()}
                {paidAmount > 0 && paidAmount < total && (
                  <Badge variant="outline" className="ml-2 text-[10px]">Partial</Badge>
                )}
                {paidAmount >= total && total > 0 && (
                  <Badge variant="secondary" className="ml-2 text-[10px]">Paid</Badge>
                )}
              </div>
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
    </ResponsiveDialog>
  );
}
