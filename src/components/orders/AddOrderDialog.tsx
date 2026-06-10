import { useState, useEffect, useMemo } from "react";
import Fuse from "fuse.js";
import { Plus, Minus, Trash2, Loader2, Ruler, ChevronDown, ChevronUp, Sparkles, ImageIcon, Search, Package, ShoppingCart, Tag } from "lucide-react";



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
import MiniProductCatalog from "./MiniProductCatalog";


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

interface ParsedAttr { key: string; value: string; }
function parseVariationAttributes(attrs: any): ParsedAttr[] {
  if (typeof attrs === "string") return [];
  if (!Array.isArray(attrs)) return [];
  return attrs.map((a: any) => {
    if (a && typeof a === "object") {
      if (a.key && a.value) return { key: String(a.key), value: String(a.value) };
      const k = Object.keys(a).find((k) => k !== "key" && k !== "value");
      if (k) return { key: k, value: String(a[k]) };
    }
    return null;
  }).filter(Boolean) as ParsedAttr[];
}

interface ProductSearchResultRowProps {
  product: { productId: string; name: string; sku: string | null; price: number; hasVariations: boolean };
  variations: VariationRow[];
  onAdd: (result: SearchResult) => void;
}

function ProductSearchResultRow({ product, variations, onAdd }: ProductSearchResultRowProps) {
  const productVars = useMemo(
    () => variations.filter((v) => v.product_id === product.productId),
    [variations, product.productId],
  );

  // Group attribute values per attribute key (e.g. Color → [Red, Blue], Size → [S, M, L])
  const attrGroups = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const v of productVars) {
      for (const a of parseVariationAttributes(v.attributes)) {
        if (!map[a.key]) map[a.key] = [];
        if (!map[a.key].includes(a.value)) map[a.key].push(a.value);
      }
    }
    return map;
  }, [productVars]);

  const attrKeys = Object.keys(attrGroups);
  const [selected, setSelected] = useState<Record<string, string>>({});

  const matchedVariation = useMemo(() => {
    if (attrKeys.length === 0) return null;
    if (!attrKeys.every((k) => selected[k])) return null;
    return productVars.find((v) => {
      const parsed = parseVariationAttributes(v.attributes);
      return attrKeys.every((k) => parsed.some((p) => p.key === k && p.value === selected[k]));
    }) || null;
  }, [productVars, attrKeys, selected]);

  const effectivePrice = matchedVariation ? Number(matchedVariation.price) : product.price;
  const canAdd = !product.hasVariations || (matchedVariation !== null);

  const handleAdd = () => {
    if (!product.hasVariations) {
      onAdd({
        id: product.productId,
        productId: product.productId,
        name: product.name,
        sku: product.sku,
        price: product.price,
      });
      return;
    }
    if (!matchedVariation) return;
    const varLabel = parseVariationAttributes(matchedVariation.attributes)
      .map((a) => a.value)
      .join(" / ") || matchedVariation.name;
    onAdd({
      id: matchedVariation.id,
      productId: product.productId,
      variationId: matchedVariation.id,
      name: product.name,
      variationLabel: varLabel,
      sku: matchedVariation.sku || product.sku,
      price: Number(matchedVariation.price),
    });
    setSelected({});
  };

  return (
    <div className="px-3 py-2.5 border-b border-border last:border-b-0 hover:bg-accent/40 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{product.name}</span>
            {product.sku && <span className="text-[11px] text-muted-foreground">{product.sku}</span>}
            {product.hasVariations && (
              <Badge variant="secondary" className="text-[10px] py-0 px-1.5">
                {productVars.length} variations
              </Badge>
            )}
          </div>
          {product.hasVariations && attrKeys.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {attrKeys.map((key) => (
                <div key={key} className="flex items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{key}</span>
                  <Select
                    value={selected[key] || ""}
                    onValueChange={(v) => setSelected((s) => ({ ...s, [key]: v }))}
                  >
                    <SelectTrigger className="h-7 text-xs w-auto min-w-[80px] gap-1">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {attrGroups[key].map((opt) => (
                        <SelectItem key={opt} value={opt} className="text-xs">{opt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm text-muted-foreground whitespace-nowrap">৳{effectivePrice.toLocaleString()}</span>
          <Button
            type="button"
            size="sm"
            variant={canAdd ? "default" : "outline"}
            disabled={!canAdd}
            onClick={handleAdd}
            className="h-7 px-2 gap-1"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function AddOrderDialog({ open, onOpenChange, onCreated }: Props) {
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [productCatMap, setProductCatMap] = useState<Map<string, Set<string>>>(new Map());
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
  const [storeId, setStoreId] = useState<string>(localStorage.getItem("last_selected_store_id") || "");
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null);
  const [showVariationModal, setShowVariationModal] = useState(false);


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
      supabase.from("products").select("id, name, sku, price, stock_quantity, image_url, category, description, store_id, created_at, barcode, is_featured, sales_count, manage_stock, stock_status").eq("is_active", true).order("name"),
      supabase.from("product_variations").select("id, product_id, name, sku, price, stock_quantity, attributes"),
      supabase.from("order_sources").select("id, name, is_default").order("sort_order"),
      supabase.from("pathao_cities").select("city_id, city_name").order("city_name"),
      supabase.from("pathao_zones").select("zone_id, zone_name, city_id"),
      supabase.from("pathao_areas").select("area_id, area_name, zone_id"),
      supabase.from("invoice_settings" as any).select("pos_custom_measurements_enabled, shipping_inside_dhaka, shipping_outside_dhaka").limit(1).maybeSingle(),
      supabase.from("stores").select("id, name").order("name"),
      supabase.from("categories").select("id, name, parent_id, store_id").order("name"),
      supabase.from("product_categories").select("product_id, category_id"),
    ]).then(([pRes, vRes, sRes, cRes, zRes, aRes, isRes, stRes, catRes, pcRes]) => {
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
      setCategories((catRes.data || []) as any[]);
      const map = new Map<string, Set<string>>();
      (pcRes.data || []).forEach((pc: any) => {
        if (!map.has(pc.product_id)) map.set(pc.product_id, new Set());
        map.get(pc.product_id)!.add(pc.category_id);
      });
      setProductCatMap(map);
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

      // Priority: city first, then zone within city, then area within zone.
      // Area is least prioritized since it's optional and area names often
      // collide across cities/zones.
      const cityMatch = strictMatch(cities, (c) => c.city_name, candidates);
      if (cityMatch) {
        nextCity = cityMatch.city_id;
        const cityZones = allZones.filter((z) => z.city_id === cityMatch.city_id);
        const zoneMatch =
          strictMatch(cityZones, (z) => z.zone_name, candidates) ||
          fuzzyMatch(cityZones, (z) => z.zone_name, candidates);
        if (zoneMatch) {
          nextZone = zoneMatch.zone_id;
          const zoneAreas = allAreas.filter((a) => a.zone_id === zoneMatch.zone_id);
          const areaMatch = strictMatch(zoneAreas, (a) => a.area_name, candidates);
          if (areaMatch) nextArea = areaMatch.area_id;
        }
      } else {
        // City not found in address — fall back to a strict global zone match
        // (back-fills the city). Avoid fuzzy global zone matching since it
        // frequently picks the wrong city.
        const zoneMatch = strictMatch(allZones, (z) => z.zone_name, candidates);
        if (zoneMatch) {
          nextZone = zoneMatch.zone_id;
          nextCity = zoneMatch.city_id;
          const zoneAreas = allAreas.filter((a) => a.zone_id === zoneMatch.zone_id);
          const areaMatch = strictMatch(zoneAreas, (a) => a.area_name, candidates);
          if (areaMatch) nextArea = areaMatch.area_id;
        }
      }

      if (nextCity !== selectedCity) setSelectedCity(nextCity);
      if (nextZone !== selectedZone) setSelectedZone(nextZone);
      if (nextArea !== selectedArea) setSelectedArea(nextArea);
    })();
    return () => { mounted = false; };
  }, [customerAddress, cities, allZones, allAreas]);

  // Per-product search index (one row per product, even if it has variations).
  // Variations contribute to searchText so users can still find a product by
  // typing a variation attribute (e.g. "blue", "L").
  interface ProductSearchRow {
    productId: string;
    name: string;
    sku: string | null;
    price: number;
    hasVariations: boolean;
    searchText: string;
  }

  const productIndex = useMemo((): ProductSearchRow[] => {
    return products.map((p) => {
      const productVariations = variations.filter((v) => v.product_id === p.id);
      const variationText = productVariations
        .map((v) => {
          const label =
            typeof v.attributes === "string"
              ? v.attributes
              : Array.isArray(v.attributes)
              ? v.attributes.map((a: any) => Object.values(a).join(": ")).join(", ")
              : v.name;
          return `${label} ${v.sku || ""}`;
        })
        .join(" ");
      return {
        productId: p.id,
        name: p.name,
        sku: p.sku,
        price: p.price,
        hasVariations: productVariations.length > 0,
        searchText: `${p.name} ${p.sku || ""} ${variationText}`,
      };
    });
  }, [products, variations]);

  const fuse = useMemo(
    () =>
      new Fuse(productIndex, {
        keys: [
          { name: "name", weight: 0.55 },
          { name: "sku", weight: 0.2 },
          { name: "searchText", weight: 0.25 },
        ],
        threshold: 0.4,
        ignoreLocation: true,
        minMatchCharLength: 2,
        includeScore: true,
      }),
    [productIndex],
  );

  const productSearchResults = useMemo((): ProductSearchRow[] => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return [];
    // Exact SKU match (product or any variation) wins
    const exactProduct = productIndex.filter((r) => (r.sku || "").toLowerCase() === q);
    if (exactProduct.length > 0) return exactProduct.slice(0, 20);
    const exactVarProductIds = new Set(
      variations.filter((v) => (v.sku || "").toLowerCase() === q).map((v) => v.product_id),
    );
    if (exactVarProductIds.size > 0) {
      return productIndex.filter((r) => exactVarProductIds.has(r.productId)).slice(0, 20);
    }
    return fuse.search(q).slice(0, 20).map((r) => r.item);
  }, [productIndex, fuse, productSearch, variations]);

  // Backwards-compatible flat index used by the AI-parse hint matcher: every
  // product (and every variation) is searchable as an addable result.
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

  // Fuse over the flat index, used by the AI parser's product hint matcher.
  const flatFuse = useMemo(
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
    // Don't reset storeId to preserve memory
    // setStoreId("");
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
        const top = flatFuse.search(q)[0];
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
          amount_to_collect: Math.max(0, total - paidAmount),
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
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left Column: Product Selection */}
        <div className="flex-1 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" />
              Product Selection
            </h3>
          </div>

          <div className="h-[500px] border border-border rounded-md overflow-hidden bg-background">
            <MiniProductCatalog
              products={products as any}
              categories={categories}
              productCatMap={productCatMap}
              stores={stores}
              onSelectProduct={(p) => {
                const isVar = variations.some(v => v.product_id === p.id);
                if (isVar) {
                   toast.info("Opening variation selection...");
                   // Since we want to keep it simple but functional, we could show the variations 
                   // in a sub-dialog or just pick the first one if we don't have the variation modal yet.
                   // For now, let's just show a toast or we can pick first variation if available.
                   const firstVar = variations.find(v => v.product_id === p.id);
                   if (firstVar) {
                     addItem({
                       id: firstVar.id,
                       productId: p.id,
                       variationId: firstVar.id,
                       name: p.name,
                       variationLabel: firstVar.name,
                       sku: firstVar.sku || p.sku,
                       price: firstVar.price,
                     });
                   }
                } else {
                  addItem({
                    id: p.id,
                    productId: p.id,
                    name: p.name,
                    sku: p.sku,
                    price: p.price,
                  });
                }
              }}
              onAddCustomItem={() => setCustomItemOpen(true)}
            />
          </div>

          {/* AI parse-from-text — relocated under catalog */}
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
              placeholder={"Paste message or screenshot (Ctrl+V)..."}
              rows={3}
              className="text-sm bg-background"
            />
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={aiParsing}
                className="h-8 text-xs"
                onClick={() => document.getElementById("ai-screenshot-input")?.click()}
              >
                <ImageIcon className="h-3.5 w-3.5 mr-1.5" />
                Screenshot
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
              <Button type="button" size="sm" onClick={handleAiParse} disabled={aiParsing || aiText.trim().length < 5} className="h-8 text-xs">
                {aiParsing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
                Parse
              </Button>
            </div>
          </div>
        </div>

        {/* Right Column: Customer & Order Details */}
        <div className="w-full lg:w-[450px] space-y-4">
          <div className="flex items-center gap-2">
             <h3 className="text-sm font-semibold">Order Details</h3>
             {items.length > 0 && <Badge variant="secondary">{items.length} items</Badge>}
          </div>

          {/* Cart Items List */}
          {items.length > 0 && (
            <div className="rounded-md border border-border bg-muted/30 max-h-[300px] overflow-y-auto">
              {items.map(item => {
                const groups = groupsByProduct[item.productId] || [];
                const showMeasureToggle = measurementsEnabled && groups.length > 0;
                return (
                  <div key={item.uid} className="border-b border-border last:border-0 p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium leading-tight truncate">{item.name}</div>
                        {item.variationLabel && <div className="text-[11px] text-muted-foreground mt-0.5">{item.variationLabel}</div>}
                        <div className="text-[11px] text-primary mt-1 font-semibold">৳{item.price.toLocaleString()}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center border border-border rounded-md bg-background">
                          <button onClick={() => updateQty(item.uid, item.qty - 1)} className="p-1 hover:bg-muted"><Minus className="h-3 w-3" /></button>
                          <span className="px-2 text-xs font-medium">{item.qty}</span>
                          <button onClick={() => updateQty(item.uid, item.qty + 1)} className="p-1 hover:bg-muted"><Plus className="h-3 w-3" /></button>
                        </div>
                        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive" onClick={() => removeItem(item.uid)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {showMeasureToggle && (
                      <div className="pt-1">
                        <div className="flex items-center justify-between rounded bg-secondary/50 px-2 py-1">
                          <span className="text-[10px] font-medium flex items-center gap-1">
                            <Ruler className="h-3 w-3" /> Measurements
                          </span>
                          <Switch
                            checked={!!item.customMeasurements}
                            onCheckedChange={(checked) =>

                              updateItem(item.uid, { customMeasurements: checked, measurementsExpanded: checked })
                            }
                          />
                        </div>

                        {item.customMeasurements && (
                           <Button
                             variant="ghost"
                             size="sm"
                             className="w-full h-6 text-[10px] mt-1"
                             onClick={() => updateItem(item.uid, { measurementsExpanded: !item.measurementsExpanded })}
                           >
                             {item.measurementsExpanded ? "Hide measurement details" : "Edit measurement details"}
                             {item.measurementsExpanded ? <ChevronUp className="ml-1 h-3 w-3" /> : <ChevronDown className="ml-1 h-3 w-3" />}
                           </Button>
                        )}

                        {item.customMeasurements && item.measurementsExpanded && (
                          <div className="mt-2 space-y-2 border-t border-border/50 pt-2">
                            {groups.map((g) => (
                              <div key={g.id} className="rounded border border-border/50 p-2 space-y-2 bg-background">
                                <div className="flex items-center justify-between">
                                  <h5 className="text-[10px] font-semibold">{g.name} ({g.unit})</h5>
                                </div>
                                <div className="grid grid-cols-3 gap-1.5">
                                  {g.fields.map((f) => (
                                    <div key={f.id}>
                                      <Label className="text-[9px] text-muted-foreground uppercase">{f.name}</Label>
                                      <Input
                                        value={item.measurementValues?.[g.id]?.[f.id] || ""}
                                        onChange={(e) => setMeasurementValue(item.uid, g.id, f.id, e.target.value)}
                                        className="h-7 px-1.5 text-[11px]"
                                      />
                                    </div>
                                  ))}
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

          {/* Customer Section */}
          <div className="space-y-3 bg-muted/20 p-3 rounded-md border border-border/50">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Name</Label>
                <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Name" className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Phone</Label>
                <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="01XXXXXXXXX" className="h-9" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Address</Label>
              <Input value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} placeholder="Full delivery address" className="h-9" />
            </div>

            {/* Pathao Location Dropdowns (More Compact) */}
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px]">City</Label>
                <SearchableSelect
                  options={cities.map((c) => ({ value: c.city_id.toString(), label: c.city_name }))}
                  value={selectedCity?.toString() || ""}
                  onChange={(v) => setSelectedCity(v ? Number(v) : null)}
                  placeholder="City"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Zone</Label>
                <SearchableSelect
                  options={zones.map((z) => ({ value: z.zone_id.toString(), label: z.zone_name }))}
                  value={selectedZone?.toString() || ""}
                  onChange={(v) => setSelectedZone(v ? Number(v) : null)}
                  placeholder="Zone"
                  className="h-8 text-xs"
                  disabled={!selectedCity}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Area</Label>
                <SearchableSelect
                  options={areas.map((a) => ({ value: a.area_id.toString(), label: a.area_name }))}
                  value={selectedArea?.toString() || ""}
                  onChange={(v) => setSelectedArea(v ? Number(v) : null)}
                  placeholder="Area"
                  className="h-8 text-xs"
                  disabled={!selectedZone}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Fulfillment</Label>
              <Select value={fulfillment} onValueChange={(v: any) => setFulfillment(v)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="delivery">Delivery</SelectItem>
                  <SelectItem value="pickup">Pickup</SelectItem>
                  <SelectItem value="walkin">Walk-in</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {stores.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs">Store</Label>
                <Select 
                  value={storeId} 
                  onValueChange={(v) => { setStoreId(v); localStorage.setItem("last_selected_store_id", v); }}
                >
                  <SelectTrigger className="h-9"><SelectValue placeholder="Store" /></SelectTrigger>
                  <SelectContent>
                    {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Shipping</Label>
              <Input type="number" value={shippingCost} onChange={(e) => { setShippingCost(Number(e.target.value)); setShippingTouched(true); }} className="h-9" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Discount</Label>
              <Input type="number" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} className="h-9" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Paid</Label>
              <Input type="number" value={paidAmount} onChange={(e) => setPaidAmount(Number(e.target.value))} className="h-9" />
            </div>
          </div>

          <div className="rounded-md border border-primary/20 bg-primary/5 p-3 space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
               <span>Subtotal: ৳{subtotal.toLocaleString()}</span>
               {discount > 0 && <span>Discount: -৳{discount.toLocaleString()}</span>}
               {shippingCost > 0 && <span>Shipping: ৳{shippingCost.toLocaleString()}</span>}
            </div>
            <div className="flex justify-between items-center">
               <span className="text-sm font-semibold">Total to Collect</span>
               <span className="text-lg font-bold text-primary">৳{Math.max(0, total - paidAmount).toLocaleString()}</span>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase">Internal Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="text-xs min-h-[50px]" />
          </div>
        </div>
      </div>

    </ResponsiveDialog>

    <ResponsiveDialog
      open={customItemOpen}
      onOpenChange={(v) => { if (!v) { setCustomItemName(""); setCustomItemPrice(""); setCustomItemQty("1"); } setCustomItemOpen(v); }}
      title="Add custom item"
      footer={
        <>
          <Button variant="outline" onClick={() => setCustomItemOpen(false)}>Cancel</Button>
          <Button onClick={addCustomItem}>Add to order</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Item name</Label>
          <Input value={customItemName} onChange={(e) => setCustomItemName(e.target.value)} placeholder="e.g. Custom alteration" autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Price</Label>
            <Input type="number" inputMode="decimal" value={customItemPrice} onChange={(e) => setCustomItemPrice(e.target.value)} placeholder="0" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Quantity</Label>
            <Input type="number" inputMode="numeric" value={customItemQty} onChange={(e) => setCustomItemQty(e.target.value)} placeholder="1" />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Custom items are not linked to a product and will not affect inventory.
        </p>
      </div>
    </ResponsiveDialog>
    </>
  );
}
