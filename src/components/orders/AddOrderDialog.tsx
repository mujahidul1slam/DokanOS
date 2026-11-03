import { useState, useEffect, useMemo, useRef } from "react";
import Fuse from "fuse.js";
import { Plus, Minus, Trash2, Loader2, Ruler, ChevronDown, ChevronUp, Sparkles, ImageIcon, Search, Package, ShoppingCart, Tag, User, Check, X } from "lucide-react";




import { supabase } from "@/integrations/supabase/client";
import { getProductVariations } from "@/lib/variations";
import { fetchAllRows } from "@/lib/supabasePage";
import { useActiveBusinessStoreIds, scopeStoreIds, hasStoreScope } from "@/hooks/useActiveBusinessStoreIds";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import { orderSourceLabel, pickDefaultOrderSource, pickWalkInSource, type OrderSourceRow } from "@/lib/orderSources";
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
import { readEdgeFnError } from "@/lib/edgeFnError";
import { buildAddressCandidates, fuzzyMatch, strictMatch } from "@/lib/pathaoMatch";


import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { staffPaymentOptions } from "@/lib/paymentAccounts";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useCurrency } from "@/hooks/useCurrency";
import { deriveBrandForProduct, deriveBrandForStore } from "@/lib/brandIdentity";
import {
  DUPLICATE_ORDER_WINDOW_MS,
  findDuplicateOrders,
  type DuplicateOrderCandidate,
  type DuplicateOrderWarning,
} from "@/lib/duplicateOrder";
import {
  isAccountOverride,
  resolveDefaultAccount,
  type PathaoAccountOption,
  type PathaoStoreLinkRow,
} from "@/lib/dispatchAccounts";
import { fetchPathaoAccountData, recordPathaoAccountOverride } from "@/lib/dispatchAccountsData";
import {
  buildDispatchOrderPayload,
  dispatchOrderViaAccount,
  newCreateIdempotencyKey,
  type DispatchEntry,
  type DispatchOutcome,
} from "@/lib/createDispatch";
import {
  fetchCourierDescriptionOptions,
  formatOrderItemProductName,
  isCourierDescriptionEnabled,
  mergeCourierDescriptionOption,
  setCourierDescriptionOption,
  type CourierDescriptionOptions,
} from "@/lib/courierDescription";
import {
  BrandAvatar,
  IdentitySegment,
  IdentityStripCard,
  MixedBrandItemChips,
  PathaoMark,
  StripWarning,
  type MixedBrandChip,
} from "@/lib/identityStrip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const normalizeBdPhone = (raw?: string | null) => {
  if (!raw) return null;
  let p = String(raw).replace(/\D/g, "");
  if (!p) return null;
  if (p.startsWith("880") && p.length >= 13) p = p.slice(3);
  if (p.length === 10 && p.startsWith("1")) p = `0${p}`;
  return p;
};

// Issue #29 (warn-only duplicate detection): one recent order row as the
// detector needs it. The brand identity comes from the Order Source binding
// first, falling back to the legacy store binding (see brandIdentity.ts).
interface RecentOrderRow {
  id: string;
  order_number: string;
  created_at: string;
  customer_phone: string | null;
  order_source_id: string | null;
  store_id: string | null;
  order_items: { product_id: string | null; product_name: string }[] | null;
}

/** Fetch the last DUPLICATE_ORDER_WINDOW_MS of visible orders + items. */
async function fetchRecentDuplicateOrders(
  resolveBrandId: (row: RecentOrderRow) => string | null,
): Promise<DuplicateOrderCandidate[]> {
  const since = new Date(Date.now() - DUPLICATE_ORDER_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from("orders")
    .select("id, order_number, created_at, customer_phone, order_source_id, store_id, order_items(product_id, product_name)")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return [];
  return ((data || []) as unknown as RecentOrderRow[]).map((row) => ({
    orderNumber: row.order_number,
    createdAt: row.created_at,
    customerPhone: row.customer_phone,
    brandId: resolveBrandId(row),
    storeId: row.store_id,
    items: (row.order_items || []).map((item) => ({
      productId: item.product_id,
      productName: item.product_name,
    })),
  }));
}

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

/** A created order kept alive across the Create & Dispatch retry UI (issue #23). */
interface PendingDispatch {
  created: { orderId: string; orderNumber: string };
  entry: DispatchEntry;
  account: PathaoAccountOption;
}

/**
 * Create & Dispatch footer state. The order is saved as soon as creation
 * succeeds; `failed` keeps it saved and offers a dispatch-only retry that can
 * never create a duplicate order (orders.idempotency_key guards the create
 * path; the retry re-runs only the dispatch step).
 */
type DispatchPhase =
  | { kind: "idle" }
  | { kind: "dispatching"; pending: PendingDispatch }
  | { kind: "failed"; pending: PendingDispatch; error: string }
  | { kind: "done"; pending: PendingDispatch; consignmentId: string; reused: boolean };

interface CustomerMatch {
  id: string;
  name: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  zone: string | null;
  area: string | null;
  orderCount: number;
}

interface LocationHints {
  city: string;
  zone: string;
  area: string;
}

const EMPTY_LOCATION_HINTS: LocationHints = { city: "", zone: "", area: "" };
const LOCATION_HINT_PREFIX = "hint:";
const normalizePlace = (v: string) => v.toLowerCase().replace(/[^a-z0-9\u0980-\u09FF]+/g, "");

/**
 * When the Pathao lists have no match for a parsed location, keep the parsed
 * text selectable so the dropdown is not silently blank (issue #4). The hint
 * option is only offered while nothing real is selected.
 */
const withHintOption = (
  options: { value: string; label: string }[],
  hint: string,
  hasSelection: boolean,
) => {
  const h = hint.trim();
  if (!h || hasSelection) return options;
  const key = normalizePlace(h);
  if (options.some((o) => normalizePlace(o.label) === key)) return options;
  return [...options, { value: `${LOCATION_HINT_PREFIX}${h}`, label: `${h} (from message)` }];
};

export default function AddOrderDialog({ open, onOpenChange, onCreated }: Props) {
  const { symbol } = useCurrency();
  const { active, brands } = useBusinessContext();
  const activeBrands = useMemo(() => brands.filter((brand) => brand.is_active), [brands]);
  const businessStoreIds = useActiveBusinessStoreIds();
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [productCatMap, setProductCatMap] = useState<Map<string, Set<string>>>(new Map());
  const [variations, setVariations] = useState<VariationRow[]>([]);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [fulfillment, setFulfillment] = useState<"walkin" | "pickup" | "delivery">("delivery");
  const [orderSources, setOrderSources] = useState<OrderSourceRow[]>([]);
  const [orderSourceId, setOrderSourceId] = useState("");
  // True once the operator picks a source by hand; auto-selection (walk-ins →
  // the showroom source, otherwise the brand's first source) backs off after.
  const sourceTouchedRef = useRef(false);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [storeId, setStoreId] = useState<string>(localStorage.getItem("last_selected_store_id") || "");
  const [selectedBrandId, setSelectedBrandId] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("last_selected_order_brand_id") || "";
  });
  const [brandWarningDismissed, setBrandWarningDismissed] = useState(false);
  // Pathao Account identity (issue #22): selectable accounts + the per-brand
  // default links (brand -> woo_store_id -> pathao_store_links).
  const [pathaoAccounts, setPathaoAccounts] = useState<PathaoAccountOption[]>([]);
  const [pathaoLinks, setPathaoLinks] = useState<PathaoStoreLinkRow[]>([]);
  const [selectedAccountKey, setSelectedAccountKey] = useState("");
  const [accountWarningDismissed, setAccountWarningDismissed] = useState(false);
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
  // Create & Dispatch (issue #23): per-form-session idempotency key + footer state.
  const [createIdempotencyKey, setCreateIdempotencyKey] = useState(newCreateIdempotencyKey);
  const [dispatchPhase, setDispatchPhase] = useState<DispatchPhase>({ kind: "idle" });
  // Per-Pathao-Account courier product description option (issue #23, default OFF).
  const [courierDescriptionOptions, setCourierDescriptionOptions] = useState<CourierDescriptionOptions>({});
  // Issue #29: warn-only duplicate-order banner state (never gates saving).
  const [duplicateWarning, setDuplicateWarning] = useState<DuplicateOrderWarning | null>(null);
  const [duplicateDismissedKey, setDuplicateDismissedKey] = useState("");


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
  // Parsed-but-unmatched city/zone/area text (from AI parse or a saved customer)
  // so the dropdowns still show what the message said.
  const [locationHints, setLocationHints] = useState<LocationHints>(EMPTY_LOCATION_HINTS);
  // Existing-customer lookup by phone (issue #19).
  const [customerMatches, setCustomerMatches] = useState<CustomerMatch[]>([]);
  const phoneLookupSeq = useRef(0);

  useEffect(() => {
    if (!open) return;
    if (!hasStoreScope(businessStoreIds)) return; // fail closed — no scope, no read
    // product_variations exceeds the Supabase REST server-side max-rows cap
    // (1180 rows vs 1000): an unpaginated fetch silently truncated at 1000,
    // so variable products whose variations fell past the boundary lost their
    // variation selector or showed only some sizes. Fetch paged until
    // exhausted; never silent on error.
    Promise.all([
      scopeStoreIds(supabase.from("products").select("id, name, sku, price, stock_quantity, image_url, category, description, store_id, created_at, barcode, is_featured, sales_count, manage_stock, stock_status").eq("is_active", true), businessStoreIds).order("name"),
      fetchAllRows((range) =>
        supabase.from("product_variations").select("id, product_id, name, sku, price, stock_quantity, attributes").range(range.from, range.to),
      ),
      supabase.from("order_sources").select("id, brand_id, name, type, is_stock_holding, is_default, accepted_payment_methods, legacy_woo_store_id").in("brand_id", brands.map((b) => b.id)),
      supabase.from("pathao_cities").select("city_id, city_name").order("city_name"),
      supabase.from("pathao_zones").select("zone_id, zone_name, city_id"),
      supabase.from("pathao_areas").select("area_id, area_name, zone_id"),
      supabase.from("invoice_settings" as any).select("pos_custom_measurements_enabled, shipping_inside_dhaka, shipping_outside_dhaka").limit(1).maybeSingle(),
      supabase.from("stores").select("id, name").in("id", businessStoreIds).order("name"),
      scopeStoreIds(supabase.from("categories").select("id, name, parent_id, store_id"), businessStoreIds).order("name"),
      supabase.from("product_categories").select("product_id, category_id"),
    ]).then(([pRes, vRes, sRes, cRes, zRes, aRes, isRes, stRes, catRes, pcRes]) => {
      const loadedProducts = pRes.data || [];
      setProducts(loadedProducts);
      // Filter wholesale-loaded variations to only those belonging to scoped products
      const scopedProductIds = new Set(loadedProducts.map((p: any) => p.id));
      setVariations((vRes as VariationRow[]).filter((v) => scopedProductIds.has(v.product_id)));
      const srcs = (sRes.data || []) as OrderSourceRow[];
      setOrderSources(srcs);
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
        if (!scopedProductIds.has(pc.product_id)) return; // skip non-scoped products
        if (!map.has(pc.product_id)) map.set(pc.product_id, new Set());
        map.get(pc.product_id)!.add(pc.category_id);
      });
      setProductCatMap(map);
    }).catch((err: any) => {
      // A failed catalog fetch must never be silent: without products or
      // variations the picker still renders, but variable products would be
      // added without sizes and items would vanish from search.
      console.error("AddOrderDialog: failed to load catalog data", err);
      toast.error(err?.message || "Failed to load product catalog");
    });

  }, [open, businessStoreIds, brands]);

  // The Brand chosen in the identity strip is the single source of truth for
  // attribution; the Stock store follows it (brand → woo_store_id, so → the
  // selected source's legacy store binding). The old form asked for a "Legacy
  // Woo store" by hand, which silently disagreed with the Brand picker and
  // listed the WRONG brand's order sources — the duplicate selector this
  // replacement removes.
  const activeBrandId = selectedBrandId || null;
  const brandSources = useMemo(
    () => orderSources.filter((s) => s.brand_id === activeBrandId),
    [orderSources, activeBrandId],
  );

  // Staff-entered orders may always use cash / manual; the rest of the method
  // list follows the selected source's accepted payment methods (spec §4).
  const selectedSourceRow = useMemo(
    () => brandSources.find((s) => s.id === orderSourceId) ?? null,
    [brandSources, orderSourceId],
  );
  const paymentOptions = useMemo(
    () => staffPaymentOptions(selectedSourceRow?.accepted_payment_methods),
    [selectedSourceRow],
  );

  // Stock store is derived, never hand-picked: the selected source's binding
  // wins, then the brand's store, then the remembered one, then the business's
  // first readable store. Any candidate outside the active business scope is
  // ignored (fail closed) — that is what the old "Legacy Woo store" select got
  // wrong when a stale localStorage value pointed at another business.
  useEffect(() => {
    if (!open) return;
    const inScope = (id: string | null | undefined): string | null =>
      id && businessStoreIds.includes(id) ? id : null;
    const remembered = localStorage.getItem("last_selected_store_id");
    const brandStoreId = activeBrands.find((b) => b.id === selectedBrandId)?.woo_store_id;
    const next =
      inScope(selectedSourceRow?.legacy_woo_store_id) ??
      inScope(brandStoreId) ??
      inScope(remembered) ??
      stores[0]?.id ??
      "";
    setStoreId((previous) => (previous === next ? previous : next));
  }, [open, selectedSourceRow, activeBrands, selectedBrandId, businessStoreIds, stores]);
  useEffect(() => {
    if (!paymentOptions.some((m) => m.code === paymentMethod)) {
      setPaymentMethod(paymentOptions[0]?.code ?? "cash");
    }
  }, [paymentOptions, paymentMethod]);

  useEffect(() => {
    if (sourceTouchedRef.current) {
      // A store/brand switch invalidates a pick made for the old brand.
      if (orderSourceId && !brandSources.some((s) => s.id === orderSourceId)) {
        sourceTouchedRef.current = false;
        setOrderSourceId("");
      }
      return;
    }
    // Walk-ins attach to the brand's physical channel (showroom first). Every
    // other order defaults to the source marked default on the Integrations
    // page — falling back to the brand's Facebook/Instagram source, then the
    // first listed source.
    const walkIn = fulfillment === "walkin" ? pickWalkInSource(brandSources) : null;
    const next = walkIn?.id ?? pickDefaultOrderSource(brandSources)?.id ?? "";
    setOrderSourceId((prev) => (prev === next ? prev : next));
  }, [brandSources, fulfillment, orderSourceId]);

  // Pathao Account options + per-brand default links for the identity strip.
  useEffect(() => {
    if (!open) return;
    let mounted = true;
    fetchPathaoAccountData().then(({ accounts, links }) => {
      if (!mounted) return;
      setPathaoAccounts(accounts);
      setPathaoLinks(links);
    });
    return () => { mounted = false; };
  }, [open]);

  // Per-account courier product description options (issue #23). Default OFF.
  useEffect(() => {
    if (!open) return;
    let mounted = true;
    fetchCourierDescriptionOptions().then((options) => {
      if (!mounted) return;
      setCourierDescriptionOptions(options);
    });
    return () => { mounted = false; };
  }, [open]);

  // A single active brand is always carried between orders. Multi-brand
  // businesses intentionally start each order clear and select a brand when
  // the first product identifies one.
  useEffect(() => {
    if (!open) return;
    setSelectedBrandId((previous) => {
      const single = activeBrands.length === 1 ? activeBrands[0].id : "";
      if (single) {
        localStorage.setItem("last_selected_order_brand_id", single);
        return single;
      }
      // Multi-brand orders intentionally start without a remembered Brand;
      // the first catalog product establishes it for this order only.
      return "";
    });
  }, [open, activeBrands]);

  const cartBrands = useMemo(() => {
    const resolved = items
      .map((item) => products.find((product) => product.id === item.productId))
      .map((product) => deriveBrandForProduct(activeBrands, product))
      .filter((brand): brand is (typeof activeBrands)[number] => Boolean(brand));
    return Array.from(new Map(resolved.map((brand) => [brand.id, brand])).values());
  }, [items, products, activeBrands]);

  const cartHasMixedBrands = cartBrands.length > 1;
  const hasBrandMismatch = Boolean(
    selectedBrandId && cartBrands.some((brand) => brand.id !== selectedBrandId),
  );
  const selectedBrand = activeBrands.find((brand) => brand.id === selectedBrandId) || null;
  // Brand default Pathao Account (brand -> woo_store_id -> pathao_store_links).
  // Order Sources carry no Woo binding of their own (their legacy_woo_store_id
  // is a stores.id), so the brand binding is the only honest fallback.
  const defaultAccount = useMemo(
    () => resolveDefaultAccount(pathaoAccounts, pathaoLinks, [
      selectedBrand?.woo_store_id,
    ]),
    [pathaoAccounts, pathaoLinks, selectedBrand],
  );
  const selectedAccount = pathaoAccounts.find((account) => account.key === selectedAccountKey) || null;
  const accountOverridden = isAccountOverride(selectedAccountKey, defaultAccount?.key);

  // Every identity change — and every dialog open — restarts from the Brand
  // default Pathao Account, never from the last manual choice (issue #22).
  useEffect(() => {
    setSelectedAccountKey(defaultAccount?.key ?? "");
    setAccountWarningDismissed(false);
  }, [defaultAccount?.key, selectedBrandId, orderSourceId, open]);

  // Per-brand item chips shown inside the strip for mixed-brand orders.
  const mixedBrandChips = useMemo<MixedBrandChip[]>(() => {
    const chipMap = new Map<string, MixedBrandChip>();
    for (const item of items) {
      const product = products.find((candidate) => candidate.id === item.productId);
      const brand = deriveBrandForProduct(activeBrands, product);
      const key = brand?.id ?? "";
      let chip = chipMap.get(key);
      if (!chip) {
        chip = {
          brandId: brand?.id ?? null,
          brandName: brand?.name ?? "No Brand",
          itemLabels: [],
        };
        chipMap.set(key, chip);
      }
      chip.itemLabels.push(
        `${item.name}${item.variationLabel ? ` - ${item.variationLabel}` : ""} ×${item.qty}`,
      );
    }
    return Array.from(chipMap.values());
  }, [items, products, activeBrands]);
  const identityBlocked = activeBrands.length > 0 && (
    !selectedBrandId || !selectedSourceRow
  );

  useEffect(() => {
    setBrandWarningDismissed(false);
  }, [selectedBrandId, cartBrands.map((brand) => brand.id).join(",")]);

  // Issue #29: warn-only duplicate detection on cart/phone/Brand change.
  // Advisory only — the banner never blocks or gates saving.
  useEffect(() => {
    if (!open) return;
    if (items.length === 0 || !customerPhone.trim() || !selectedBrandId) {
      setDuplicateWarning(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const sourceBrand = new Map(orderSources.map((source) => [source.id, source.brand_id]));
      const resolveBrandId = (row: RecentOrderRow): string | null => {
        const viaSource = row.order_source_id
          ? sourceBrand.get(row.order_source_id)
          : undefined;
        return viaSource ?? deriveBrandForStore(activeBrands, row.store_id)?.id ?? null;
      };
      const candidate: DuplicateOrderCandidate = {
        // Draft order numbers cannot collide with saved orders (the detector
        // excludes self-matches by order number).
        orderNumber: `DRAFT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
        createdAt: new Date().toISOString(),
        customerPhone,
        brandId: selectedBrandId,
        storeId,
        items: items.map((item) => ({
          productId: item.isCustomItem || !item.productId ? null : item.productId,
          productName: formatOrderItemProductName(item.name, item.variationLabel),
        })),
      };
      fetchRecentDuplicateOrders(resolveBrandId).then((recent) => {
        if (cancelled) return;
        setDuplicateWarning(findDuplicateOrders(candidate, recent));
      });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, items, customerPhone, selectedBrandId, activeBrands, orderSources, storeId]);

  // Re-show a dismissed banner only when the match set actually changes.
  const duplicateBannerKey = useMemo(() => {
    if (!duplicateWarning?.isDuplicateCandidate) return "";
    return duplicateWarning.matches
      .map((match) => `${match.orderNumber}:${match.sharedProducts.map((p) => p.name).join("+")}`)
      .join("|");
  }, [duplicateWarning]);
  const showDuplicateBanner =
    duplicateBannerKey !== "" && duplicateBannerKey !== duplicateDismissedKey;

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
  // its city. Otherwise just match the city. Area/zone fuzzy matching stays
  // scoped (area within zone, zone within city) and rejects ambiguous ties.
  useEffect(() => {
    if (!customerAddress || customerAddress.length < 3) return;
    if (allZones.length === 0 && cities.length === 0) return;
    const candidates = buildAddressCandidates([customerAddress]);

    let nextCity = selectedCity;
    let nextZone = selectedZone;
    let nextArea = selectedArea;
    let cityMatched = false;
    let zoneMatched = false;
    let areaMatched = false;

    const matchArea = (zoneAreas: typeof allAreas) =>
      strictMatch(zoneAreas, (a) => a.area_name, candidates) ||
      fuzzyMatch(zoneAreas, (a) => a.area_name, candidates);

    // Priority: city first, then zone within city, then area within zone.
    const cityMatch = strictMatch(cities, (c) => c.city_name, candidates);
    if (cityMatch) {
      cityMatched = true;
      nextCity = cityMatch.city_id;
      const cityZones = allZones.filter((z) => z.city_id === cityMatch.city_id);
      const zoneMatch =
        strictMatch(cityZones, (z) => z.zone_name, candidates) ||
        fuzzyMatch(cityZones, (z) => z.zone_name, candidates);
      if (zoneMatch) {
        zoneMatched = true;
        nextZone = zoneMatch.zone_id;
        const areaMatch = matchArea(allAreas.filter((a) => a.zone_id === zoneMatch.zone_id));
        if (areaMatch) { areaMatched = true; nextArea = areaMatch.area_id; }
      } else {
        // The address may name an area but not its zone — resolve the area
        // across the city's zones and back-fill the zone it belongs to.
        const cityZoneIds = new Set(cityZones.map((z) => z.zone_id));
        const areaMatch = matchArea(allAreas.filter((a) => cityZoneIds.has(a.zone_id)));
        if (areaMatch) {
          areaMatched = true;
          nextArea = areaMatch.area_id;
          nextZone = areaMatch.zone_id;
          zoneMatched = true;
        }
      }
    } else {
      // City not found in address — fall back to a strict global zone match
      // (back-fills the city). Avoid fuzzy global zone matching since it
      // frequently picks the wrong city.
      const zoneMatch = strictMatch(allZones, (z) => z.zone_name, candidates);
      if (zoneMatch) {
        zoneMatched = true;
        nextZone = zoneMatch.zone_id;
        nextCity = zoneMatch.city_id;
        const areaMatch = matchArea(allAreas.filter((a) => a.zone_id === zoneMatch.zone_id));
        if (areaMatch) { areaMatched = true; nextArea = areaMatch.area_id; }
      }
    }

    if (nextCity !== selectedCity) setSelectedCity(nextCity);
    if (nextZone !== selectedZone) setSelectedZone(nextZone);
    if (nextArea !== selectedArea) setSelectedArea(nextArea);
    // Drop hints once the real list matches; keep the ones still unmatched.
    setLocationHints((prev) => ({
      city: cityMatched ? "" : prev.city,
      zone: zoneMatched ? "" : prev.zone,
      area: areaMatched ? "" : prev.area,
    }));
  }, [customerAddress, cities, allZones, allAreas]);

  const cityOptions = useMemo(
    () => withHintOption(
      cities.map((c) => ({ value: c.city_id.toString(), label: c.city_name })),
      locationHints.city,
      selectedCity != null,
    ),
    [cities, locationHints.city, selectedCity],
  );
  const zoneOptions = useMemo(
    () => withHintOption(
      zones.map((z) => ({ value: z.zone_id.toString(), label: z.zone_name })),
      locationHints.zone,
      selectedZone != null,
    ),
    [zones, locationHints.zone, selectedZone],
  );
  const areaOptions = useMemo(
    () => withHintOption(
      areas.map((a) => ({ value: a.area_id.toString(), label: a.area_name })),
      locationHints.area,
      selectedArea != null,
    ),
    [areas, locationHints.area, selectedArea],
  );

  /* ─── Existing customer lookup by phone (#19) ─── */
  const lookupCustomerByPhone = async () => {
    const phone = normalizeBdPhone(customerPhone);
    if (!phone || phone.length < 11) { setCustomerMatches([]); return; }
    const seq = ++phoneLookupSeq.current;
    const { data } = await supabase
      .from("customers")
      .select("id, name, phone, address, city, zone, area")
      .eq("phone", phone)
      .limit(10);
    if (seq !== phoneLookupSeq.current) return;
    let rows = (data || []) as Omit<CustomerMatch, "orderCount">[];

    // Phones can also be reachable through customer_aliases (the spec's
    // multi-match case). Match by value so any alias type carrying the number
    // resolves; merge and dedupe with the direct phone hits.
    const { data: aliasRows } = await supabase
      .from("customer_aliases")
      .select("customer_id")
      .eq("value", phone)
      .limit(10);
    if (seq !== phoneLookupSeq.current) return;
    const aliasIds = [...new Set((aliasRows || []).map((a) => a.customer_id))]
      .filter((id) => !rows.some((r) => r.id === id));
    if (aliasIds.length > 0) {
      const { data: aliasCustomers } = await supabase
        .from("customers")
        .select("id, name, phone, address, city, zone, area")
        .in("id", aliasIds)
        .limit(10);
      if (seq !== phoneLookupSeq.current) return;
      rows = [...rows, ...((aliasCustomers || []) as Omit<CustomerMatch, "orderCount">[])]
        .slice(0, 10);
    }
    if (rows.length === 0) { setCustomerMatches([]); return; }

    // Exact per-customer counts: a single unbounded orders fetch both
    // under-reports past the REST row cap and drags every order row down.
    const counts = await Promise.all(
      rows.map(async (r) => {
        const { count } = await supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("customer_id", r.id);
        return [r.id, count ?? 0] as const;
      }),
    );
    if (seq !== phoneLookupSeq.current) return;
    setCustomerMatches(rows.map((r) => ({ ...r, orderCount: new Map(counts).get(r.id) || 0 })));
  };

  // Clearing the phone input must dismiss the existing-customer card(s)
  // immediately — otherwise matches found for the previous number linger
  // until the next blur or a manual Dismiss. Bumping the lookup sequence on
  // every phone edit also invalidates any lookup still in flight, so a slow
  // response can never resurrect matches for a phone the user has already
  // changed away from (lookupCustomerByPhone drops out when the seq no
  // longer matches).
  useEffect(() => {
    phoneLookupSeq.current += 1;
    if (!customerPhone.trim()) {
      setCustomerMatches((prev) => (prev.length > 0 ? [] : prev));
    }
  }, [customerPhone]);

  // Explicit Fill click: populates empty fields only — never silently replaces
  // something the user already typed.
  const fillFromCustomer = (c: CustomerMatch) => {
    if (!customerName.trim() && c.name) setCustomerName(c.name);
    if (!customerPhone.trim() && c.phone) setCustomerPhone(normalizeBdPhone(c.phone) || c.phone);
    if (!customerAddress.trim() && c.address) setCustomerAddress(c.address);

    const candidates = buildAddressCandidates([c.city, c.zone, c.area, c.address]);
    const cityMatch = selectedCity != null
      ? cities.find((x) => x.city_id === selectedCity)
      : strictMatch(cities, (x) => x.city_name, candidates) ||
        fuzzyMatch(cities, (x) => x.city_name, candidates);
    const cityId = cityMatch?.city_id ?? null;

    let zoneMatch: { zone_id: number; zone_name: string } | undefined;
    let areaMatch: { area_id: number; area_name: string } | undefined;
    if (cityId != null) {
      const cityZones = allZones.filter((z) => z.city_id === cityId);
      zoneMatch = strictMatch(cityZones, (z) => z.zone_name, candidates) ||
        fuzzyMatch(cityZones, (z) => z.zone_name, candidates);
      if (zoneMatch) {
        const zoneAreas = allAreas.filter((a) => a.zone_id === zoneMatch!.zone_id);
        areaMatch = strictMatch(zoneAreas, (a) => a.area_name, candidates) ||
          fuzzyMatch(zoneAreas, (a) => a.area_name, candidates);
      }
    }

    if (selectedCity == null && cityId != null) setSelectedCity(cityId);
    if (selectedZone == null && zoneMatch) setSelectedZone(zoneMatch.zone_id);
    if (selectedArea == null && areaMatch) setSelectedArea(areaMatch.area_id);

    setLocationHints((prev) => ({
      city: selectedCity == null && !cityMatch && c.city ? c.city : prev.city,
      zone: selectedZone == null && !zoneMatch && c.zone ? c.zone : prev.zone,
      area: selectedArea == null && !areaMatch && c.area ? c.area : prev.area,
    }));
    setCustomerMatches([]);
  };

  // Backwards-compatible flat index used by the AI-parse hint matcher: every
  // product (and every variation) is searchable as an addable result.
  const searchIndex = useMemo((): (SearchResult & { searchText: string })[] => {
    const flat: (SearchResult & { searchText: string })[] = [];
    for (const p of products) {
      const productVariations = getProductVariations(p.id, variations);
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
    const product = products.find((candidate) => candidate.id === result.productId);
    const productBrand = deriveBrandForProduct(activeBrands, product);
    // In a multi-brand business the first catalog product establishes the
    // Brand. A deliberate selection is never replaced; later mismatches are
    // surfaced as a dismissible warning instead.
    if (!selectedBrandId && productBrand) {
      setSelectedBrandId(productBrand.id);
      if (activeBrands.length === 1) {
        localStorage.setItem("last_selected_order_brand_id", productBrand.id);
      }
    }
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

  // Variations belonging to the product whose variation modal is open. Resolved
  // with the shared case-insensitive lookup so in-stock variations are never
  // hidden from the picker.
  const selectedProductVariations = useMemo(
    () => getProductVariations(selectedProduct?.id, variations),
    [selectedProduct, variations],
  );

  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const total = subtotal - discount + shippingCost;

  const resetForm = () => {
    setItems([]); setCustomerName(""); setCustomerPhone(""); setCustomerAddress("");
    setSelectedBrandId(activeBrands.length === 1 ? activeBrands[0].id : "");
    setBrandWarningDismissed(false);
    setAccountWarningDismissed(false);
    setFulfillment("delivery");
    sourceTouchedRef.current = false;
    setOrderSourceId("");
    setShippingCost(0); setShippingTouched(false);
    setDiscount(0);
    setPaidAmount(0);
    setPaymentMethod("cash");
    setNotes("");
    setSelectedCity(null); setSelectedZone(null); setSelectedArea(null);
    setLocationHints(EMPTY_LOCATION_HINTS);
    setCustomerMatches([]);
    setAiText("");
    // Fresh form session = fresh create idempotency key (issue #23) and no
    // leftover Create & Dispatch result state.
    setCreateIdempotencyKey(newCreateIdempotencyKey());
    setDispatchPhase({ kind: "idle" });
    setDuplicateWarning(null);
    setDuplicateDismissedKey("");
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
      // Keep the AI's location values even when the matcher below can't find
      // them in the Pathao lists — the dropdowns show them as "(from message)".
      setLocationHints({
        city: typeof p.city === "string" ? p.city : "",
        zone: typeof p.zone === "string" ? p.zone : "",
        area: typeof p.area === "string" ? p.area : "",
      });
      if (typeof p.shipping_cost === "number") { setShippingCost(p.shipping_cost); setShippingTouched(true); filled.push("shipping"); }
      if (typeof p.discount === "number") { setDiscount(p.discount); filled.push("discount"); }
      if (p.notes) {
        setNotes((prev) => prev ? `${prev}\n${p.notes}` : p.notes);
        filled.push("notes");
      }
      if (typeof p.due_amount === "number") {
        const dueLine = `Due: ${symbol}${p.due_amount.toLocaleString()}`;
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
      // functions-js hides the edge function's body behind a generic non-2xx
      // message. Read it so a missing LOVABLE_API_KEY is actionable, not opaque.
      const body = await readEdgeFnError(err);
      const message = body?.error || body?.message || err?.message || "Failed to parse";
      if (/not configured|LOVABLE_API_KEY/i.test(message)) {
        toast.error("AI parsing is not configured on the server. Ask an admin to restore the LOVABLE_API_KEY Edge Function secret.");
      } else {
        toast.error(message);
      }
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


  // Shared validation for both footer buttons (issue #23).
  const validateOrderForm = (): boolean => {
    if (!hasStoreScope(businessStoreIds)) { toast.error("No active business scope — cannot create order"); return false; }
    if (items.length === 0) { toast.error("Add at least one product"); return false; }
    if (activeBrands.length > 0 && !selectedBrandId) {
      toast.error("Choose a Brand before creating the order");
      return false;
    }
    if (activeBrands.length > 0 && brandSources.length === 0) {
      toast.error("Configure an Order Source for this Brand in Brands → Order Sources");
      return false;
    }
    if (activeBrands.length > 0 && !selectedSourceRow) {
      toast.error("Choose an Order Source before creating the order");
      return false;
    }
    return true;
  };

  // Create & Dispatch only: the courier needs a deliverable customer and a
  // Pathao destination (mirrors DispatchDialog's missing-details check).
  const validateDispatchRequirements = (): boolean => {
    if (!customerName.trim()) {
      toast.error("Enter the customer name before dispatching");
      return false;
    }
    if (!customerPhone.trim() || !normalizeBdPhone(customerPhone)) {
      toast.error("Enter the customer phone before dispatching");
      return false;
    }
    if (!customerAddress.trim()) {
      toast.error("Enter the customer address before dispatching");
      return false;
    }
    if (selectedCity == null) {
      toast.error("Choose a recipient City before dispatching");
      return false;
    }
    if (selectedZone == null) {
      toast.error("Choose a recipient Zone before dispatching");
      return false;
    }
    if (!selectedAccount) {
      toast.error("Choose a Pathao Account before dispatching");
      return false;
    }
    return true;
  };

  /**
   * The one create path shared by "Create Order" and "Create & Dispatch"
   * (issue #23): customer, order, items, payments, measurements, timeline.
   *
   * Idempotent against the existing create_order guard: orders.idempotency_key
   * carries this form session's key under uq_orders_idempotency_key, so a
   * re-run that reaches creation again (double submit, or a Create & Dispatch
   * retry) gets the already-created order back instead of a duplicate.
   */
  const createOrderRecord = async (): Promise<{ orderId: string; orderNumber: string } | null> => {
    const orderStoreId = storeId && businessStoreIds.includes(storeId) ? storeId : null;
    if (!orderStoreId) { toast.error("Select a store belonging to the active business"); return null; }
    const selectedSource = brandSources.find((s) => s.id === orderSourceId) ?? null;
    const sourceName = selectedSource?.name ?? "manual";
    setSaving(true);
    try {
        const cityName = cities.find(c => c.city_id === selectedCity)?.city_name || locationHints.city || null;
        const zoneName = zones.find(z => z.zone_id === selectedZone)?.zone_name || locationHints.zone || null;
        const areaName = areas.find(a => a.area_id === selectedArea)?.area_name || locationHints.area || null;
        let customerId: string | null = null;
        const normalizedCustomerPhone = normalizeBdPhone(customerPhone);
        if (customerName || normalizedCustomerPhone) {
          if (normalizedCustomerPhone) {
            const { data: existing } = await scopeStoreIds(supabase.from("customers").select("id").eq("phone", normalizedCustomerPhone), businessStoreIds).limit(1).maybeSingle();
            if (existing) {
              customerId = existing.id;
              // No store filter: a customer found by phone inside the active
              // business may carry a different (or null) store_id, and the old
              // `.eq("store_id", ...)` made this UPDATE silently affect zero
              // rows — the "customer info doesn't save" bug. RLS already fails
              // closed across businesses.
              const { error: customerUpdateError } = await supabase.from("customers").update({
                name: customerName || undefined,
                phone: normalizedCustomerPhone,
                address: customerAddress || undefined,
                city: cityName || undefined,
                zone: zoneName || undefined,
                area: areaName || undefined,
              }).eq("id", customerId);
              if (customerUpdateError) throw customerUpdateError;
            }
          }
          if (!customerId) {
            const { data: newC } = await supabase.from("customers").insert({
              name: customerName || "Customer",
              phone: normalizedCustomerPhone,
              address: customerAddress || null,
              city: cityName,
              zone: zoneName,
              area: areaName,
              source: sourceName,
              origin_order_source_id: selectedSource?.id ?? null,
              origin_kind: "manual",
              store_id: orderStoreId,
            }).select("id").single();
            customerId = newC?.id || null;
          }
        }

        // Order Sources carry no Woo binding (their legacy_woo_store_id is a
        // stores.id), so order numbering falls back to the brand binding first.
        const legacyStoreId = activeBrands.find((brand) => brand.id === selectedBrandId)?.woo_store_id ||
          storeId || null;
        const { data: genNum } = await supabase.rpc("generate_pos_order_number" as any, { p_store_id: legacyStoreId, p_source: "manual" });
        const orderNumber = (genNum as string) || `ORD-${Date.now().toString(36).toUpperCase()}`;

        const paymentStatus =
          paidAmount <= 0 ? "unpaid" : paidAmount >= total ? "paid" : "partial";

        const { data: order, error } = await supabase.from("orders").insert({
          order_number: orderNumber,
          order_source_id: selectedSource?.id ?? null,
          status: "processing",
          payment_status: paymentStatus,
          payment_method: paidAmount > 0 || paymentMethod === "cod" ? paymentMethod : null,
          fulfillment_type: fulfillment,
          customer_id: customerId,
          customer_name: customerName || null,
          customer_phone: normalizedCustomerPhone,
          customer_address: customerAddress || null,
          customer_city: cityName || null,
          store_id: legacyStoreId,
          subtotal,
          discount,
          shipping_cost: shippingCost,
          total,
          amount_to_collect: Math.max(0, total - paidAmount),
          notes: notes || null,
          pathao_recipient_city: selectedCity,
          pathao_recipient_zone: selectedZone,
          pathao_recipient_area: selectedArea,
          // create_order guard: per-form-session key so a retried create
          // returns this order instead of inserting a duplicate (issue #23).
          idempotency_key: createIdempotencyKey,
        }).select("id").single();

      if (error) {
        // create_order guard (uq_orders_idempotency_key): this form session's
        // order already exists — a re-run must reuse it, never duplicate it
        // (issue #23).
        if (error.code === "23505" && createIdempotencyKey) {
          const { data: existingOrder } = await supabase
            .from("orders")
            .select("id, order_number")
            .eq("idempotency_key", createIdempotencyKey)
            .maybeSingle();
          if (existingOrder) {
            return { orderId: existingOrder.id, orderNumber: existingOrder.order_number };
          }
        }
        throw error;
      }

      const orderItemsPayload = items.map(i => ({
        order_id: order.id,
        product_id: i.isCustomItem || !i.productId ? null : i.productId,
        product_name: formatOrderItemProductName(i.name, i.variationLabel),
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
          const expectedName = formatOrderItemProductName(cartItem.name, cartItem.variationLabel);
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
        description: `Order placed manually (${sourceName})`,
        metadata: { order_number: orderNumber, source: sourceName, order_source_id: selectedSource?.id ?? null },
      });

      await logAction("create", "order", order.id, {
        order_number: orderNumber, source: sourceName,
      });

      // Non-default Pathao Account chosen in the identity strip (issue #22):
      // record the override in the timeline + audit log as the intended
      // dispatch account for this order.
      if (accountOverridden && selectedAccount && defaultAccount) {
        await recordPathaoAccountOverride({
          orderIds: [order.id],
          orderNumbers: { [order.id]: orderNumber },
          brandName: selectedBrand?.name ?? null,
          defaultAccount,
          selectedAccount,
          context: "created",
        });
      }

      return { orderId: order.id, orderNumber };
    } catch (err: any) {
      toast.error(err.message || "Failed to create order");
      return null;
    }
  };

  const handleCreate = async () => {
    if (!validateOrderForm()) return;
    setSaving(true);
    try {
      const created = await createOrderRecord();
      if (!created) return;
      toast.success(`Order ${created.orderNumber} created`);
      resetForm();
      onOpenChange(false);
      onCreated();
    } finally {
      setSaving(false);
    }
  };

  // One dispatch attempt against an already-created order. Shared by "Create &
  // Dispatch" and "Retry dispatch" — the retry re-runs ONLY this step (issue #23).
  const runDispatch = async (pending: PendingDispatch) => {
    setDispatchPhase({ kind: "dispatching", pending });
    let outcome: DispatchOutcome;
    try {
      outcome = await dispatchOrderViaAccount(pending.entry, pending.account);
    } catch (err: any) {
      outcome = { status: "failed", error: err?.message || "Dispatch failed" };
    }
    if (outcome.status === "failed") {
      setDispatchPhase({ kind: "failed", pending, error: outcome.error });
      toast.error(`Order ${pending.created.orderNumber} is saved, but dispatch failed`, {
        description: outcome.error,
      });
      return;
    }
    setDispatchPhase({
      kind: "done",
      pending,
      consignmentId: outcome.consignmentId,
      reused: outcome.status === "already_dispatched",
    });
    toast.success(`Order ${pending.created.orderNumber} dispatched to Pathao`, {
      description: `Consignment: ${outcome.consignmentId}`,
    });
  };

  const handleCreateAndDispatch = async () => {
    if (!validateOrderForm()) return;
    if (!validateDispatchRequirements()) return;
    setSaving(true);
    try {
      const created = await createOrderRecord();
      if (!created) return;
      // The order is saved from here on — refresh lists even though the dialog
      // stays open for the dispatch step.
      onCreated();
      await runDispatch(buildPendingDispatch(created));
    } finally {
      setSaving(false);
    }
  };

  /** Courier payload built from the CURRENT form state (issue #23 + #11). */
  const buildPendingDispatch = (created: { orderId: string; orderNumber: string }): PendingDispatch => {
    const account = selectedAccount!;
    const entry = buildDispatchOrderPayload(
      {
        orderId: created.orderId,
        orderNumber: created.orderNumber,
        recipientName: customerName.trim(),
        recipientPhone: normalizeBdPhone(customerPhone) || customerPhone.trim(),
        recipientAddress: customerAddress.trim(),
        recipientCity: selectedCity!,
        recipientZone: selectedZone!,
        recipientArea: selectedArea,
        itemQuantity: items.reduce((sum, item) => sum + item.qty, 0),
        itemWeight: null,
        amountToCollect: Math.max(0, total - paidAmount),
        itemLines: items.map((item) => ({
          product_name: formatOrderItemProductName(item.name, item.variationLabel),
          quantity: item.qty,
        })),
        includeItemDescription: isCourierDescriptionEnabled(courierDescriptionOptions, account.key),
      },
      account,
    );
    return { created, entry, account };
  };

  /**
   * Re-apply the form's contact/destination/money fields to the already-saved
   * order before a dispatch retry. Without it, editing the customer after a
   * failed dispatch changed nothing: the retry only re-sent the payload
   * captured at creation time, so the order (and its customer) kept the old
   * details. Order row first, then the linked customer row.
   */
  const syncOrderFromForm = async (orderId: string) => {
    const cityName = cities.find((c) => c.city_id === selectedCity)?.city_name || locationHints.city || null;
    const zoneName = zones.find((z) => z.zone_id === selectedZone)?.zone_name || locationHints.zone || null;
    const areaName = areas.find((a) => a.area_id === selectedArea)?.area_name || locationHints.area || null;
    const { data: updatedOrder, error } = await supabase
      .from("orders")
      .update({
        customer_name: customerName.trim() || null,
        customer_phone: normalizeBdPhone(customerPhone) || null,
        customer_address: customerAddress.trim() || null,
        customer_city: cityName,
        pathao_recipient_city: selectedCity,
        pathao_recipient_zone: selectedZone,
        pathao_recipient_area: selectedArea,
        subtotal,
        discount,
        shipping_cost: shippingCost,
        total,
        amount_to_collect: Math.max(0, total - paidAmount),
      })
      .eq("id", orderId)
      .select("customer_id")
      .maybeSingle();
    if (error) throw error;
    if (updatedOrder?.customer_id) {
      const { error: customerError } = await supabase
        .from("customers")
        .update({
          name: customerName.trim() || "Customer",
          phone: normalizeBdPhone(customerPhone) || null,
          address: customerAddress.trim() || null,
          city: cityName,
          zone: zoneName,
          area: areaName,
        })
        .eq("id", updatedOrder.customer_id);
      if (customerError) throw customerError;
    }
  };

  // Dispatch-only retry: the order stays saved and this can never create a
  // duplicate (issue #23). The edge function's consignment guard additionally
  // stops a second parcel when the first attempt actually landed on Pathao.
  // Edited customer details are persisted first, then the payload is rebuilt
  // from the current form state so the courier gets the corrected address.
  const handleRetryDispatch = async () => {
    if (dispatchPhase.kind !== "failed") return;
    setSaving(true);
    try {
      const pending = dispatchPhase.pending;
      await syncOrderFromForm(pending.created.orderId);
      await runDispatch(buildPendingDispatch(pending.created));
    } catch (err: any) {
      toast.error(err?.message || "Couldn't save the edited customer details");
    } finally {
      setSaving(false);
    }
  };

  const closeAfterDispatch = () => {
    resetForm();
    onOpenChange(false);
    onCreated();
  };

  // Courier product descriptions (issue #23): optimistic toggle for the
  // selected Pathao Account, persisted under one app_settings key.
  const handleToggleCourierDescription = async (enabled: boolean) => {
    if (!selectedAccount) return;
    const accountKey = selectedAccount.key;
    const previous = courierDescriptionOptions;
    setCourierDescriptionOptions(mergeCourierDescriptionOption(previous, accountKey, enabled));
    try {
      const next = await setCourierDescriptionOption(accountKey, enabled);
      setCourierDescriptionOptions(next);
    } catch {
      setCourierDescriptionOptions(previous);
      toast.error("Couldn't save the courier product description option");
    }
  };

  return (
    <>
    <ResponsiveDialog
      open={open}
      onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}
      title="Add New Order"
      desktopMaxWidth="max-w-6xl"
      footer={
        <div className="w-full space-y-3">
          {activeBrands.length > 0 && (
            <IdentityStripCard>
              <div className="flex flex-wrap items-stretch gap-2">
                {/* Brand — logo-or-monogram + name, click to change */}
                <Popover>
                  <PopoverTrigger asChild>
                    <IdentitySegment
                      label="Brand"
                      value={selectedBrand?.name ?? "Choose Brand"}
                      icon={
                        <BrandAvatar
                          brandId={selectedBrand?.id ?? null}
                          brandName={selectedBrand?.name ?? null}
                          logoUrl={selectedBrand?.logo_url ?? null}
                        />
                      }
                      onClick={() => {}}
                    />
                  </PopoverTrigger>
                  <PopoverContent align="start" side="top" className="w-[280px] p-1">
                    {activeBrands.map((brand) => (
                      <button
                        key={brand.id}
                        type="button"
                        onClick={() => {
                          setSelectedBrandId(brand.id);
                          setBrandWarningDismissed(false);
                          if (activeBrands.length === 1) localStorage.setItem("last_selected_order_brand_id", brand.id);
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
                      >
                        <BrandAvatar brandId={brand.id} brandName={brand.name} logoUrl={brand.logo_url} className="h-6 w-6" />
                        <span className="flex-1 truncate">{brand.name}</span>
                        {brand.id === selectedBrandId && <Check className="h-3.5 w-3.5" />}
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
                {/* Order Source — the brand-owned identity every order is attributed
                    to. A disabled segment must not open its popover, so it
                    renders outside one. */}
                {!selectedBrandId || brandSources.length === 0 ? (
                  <IdentitySegment
                    label="Order Source"
                    value={
                      selectedSourceRow?.name ??
                      (brandSources.length === 0 ? "Configure in Brands" : "Choose Order Source")
                    }
                    disabled
                  />
                ) : (
                <Popover>
                  <PopoverTrigger asChild>
                    <IdentitySegment
                      label="Order Source"
                      value={selectedSourceRow?.name ?? "Choose Order Source"}
                      onClick={() => {}}
                    />
                  </PopoverTrigger>
                  <PopoverContent align="start" side="top" className="w-[280px] p-1">
                    {brandSources.map((source) => (
                      <button
                        key={source.id}
                        type="button"
                        onClick={() => {
                          sourceTouchedRef.current = true;
                          setOrderSourceId(source.id);
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
                      >
                        <span className="flex-1 truncate">{source.name}</span>
                        {source.id === (pickDefaultOrderSource(brandSources)?.id ?? "") && (
                          <Badge variant="outline" className="text-[9px]">Default</Badge>
                        )}
                        {source.id === orderSourceId && <Check className="h-3.5 w-3.5" />}
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
                )}
                {/* Pathao Account — mark + account name + pickup store, click to change */}
                {pathaoAccounts.length === 0 ? (
                  <IdentitySegment
                    label="Pathao Account"
                    value="Unavailable"
                    icon={<PathaoMark />}
                    disabled
                  />
                ) : (
                <Popover>
                  <PopoverTrigger asChild>
                    <IdentitySegment
                      label="Pathao Account"
                      value={
                        selectedAccount?.accountName ??
                        "Choose Pathao Account"
                      }
                      subValue={
                        selectedAccount
                          ? `Pickup: ${selectedAccount.pickupStoreName}`
                          : defaultAccount
                            ? `Default: ${defaultAccount.accountName}`
                            : undefined
                      }
                      icon={<PathaoMark />}
                      onClick={() => {}}
                    />
                  </PopoverTrigger>
                  <PopoverContent align="start" side="top" className="w-[300px] p-1">
                    {pathaoAccounts.map((account) => (
                      <button
                        key={account.key}
                        type="button"
                        onClick={() => {
                          setSelectedAccountKey(account.key);
                          setAccountWarningDismissed(false);
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
                      >
                        <PathaoMark className="h-6 w-6" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{account.accountName}</span>
                          <span className="block truncate text-[10px] text-muted-foreground">
                            Pickup: {account.pickupStoreName}
                          </span>
                        </span>
                        {account.key === defaultAccount?.key && (
                          <Badge variant="outline" className="text-[9px]">Default</Badge>
                        )}
                        {account.key === selectedAccountKey && <Check className="h-3.5 w-3.5 shrink-0" />}
                      </button>
                    ))}
                    {/* Courier product descriptions (issue #23): per-account
                        option, default OFF, persisted in app_settings. */}
                    <Separator className="my-1" />
                    <div className="flex items-start justify-between gap-2 px-2 py-1.5">
                      <div className="min-w-0">
                        <p className="text-xs font-medium">Courier product descriptions</p>
                        <p className="text-[10px] text-muted-foreground">
                          {selectedAccount
                            ? `Include product names, quantities and sizes on the courier label for ${selectedAccount.accountName}. Off by default.`
                            : "Choose a Pathao Account to configure this."}
                        </p>
                      </div>
                      <Switch
                        checked={isCourierDescriptionEnabled(courierDescriptionOptions, selectedAccount?.key)}
                        disabled={!selectedAccount}
                        onCheckedChange={handleToggleCourierDescription}
                      />
                    </div>
                  </PopoverContent>
                </Popover>
                )}
              </div>
              {brandSources.length === 0 && selectedBrandId && (
                <p className="text-[11px] text-destructive">No Order Source is configured for this Brand. Add one in Brands → Order Sources.</p>
              )}
              {/* Mixed-brand orders: per-brand item chips + warning inside the strip */}
              {cartHasMixedBrands && <MixedBrandItemChips chips={mixedBrandChips} />}
              {(cartHasMixedBrands || hasBrandMismatch) && !brandWarningDismissed && (
                <StripWarning
                  message={cartHasMixedBrands
                    ? "This order contains products from multiple Brands; the selected Brand remains the order identity."
                    : "The selected Brand does not match one or more products in this order."}
                  onDismiss={() => setBrandWarningDismissed(true)}
                />
              )}
              {accountOverridden && !accountWarningDismissed && (
                <StripWarning
                  message={`This order will dispatch through a non-default Pathao Account (${selectedAccount?.accountName} · ${selectedAccount?.pickupStoreName}).`}
                  onDismiss={() => setAccountWarningDismissed(true)}
                />
              )}
            </IdentityStripCard>
          )}
          {dispatchPhase.kind === "idle" ? (
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => { resetForm(); onOpenChange(false); }}>Cancel</Button>
              <Button onClick={handleCreate} disabled={saving || items.length === 0 || identityBlocked}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create Order
              </Button>
              <Button onClick={handleCreateAndDispatch} disabled={saving || items.length === 0 || identityBlocked}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create &amp; Dispatch
              </Button>
            </div>
          ) : dispatchPhase.kind === "dispatching" ? (
            <div className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  Order {dispatchPhase.pending.created.orderNumber} saved — dispatching to Pathao…
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  Through {dispatchPhase.pending.account.accountName} · Pickup: {dispatchPhase.pending.account.pickupStoreName}
                </p>
              </div>
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            </div>
          ) : dispatchPhase.kind === "failed" ? (
            // The order stays saved on dispatch failure (issue #23); the retry
            // button re-runs the dispatch step only — it can never create a
            // duplicate order.
            <div className="space-y-2 rounded-md border border-destructive/50 bg-destructive/5 p-3">
              <p className="text-sm font-medium">
                Order {dispatchPhase.pending.created.orderNumber} is saved, but dispatch failed.
              </p>
              <p className="text-xs text-muted-foreground">{dispatchPhase.error}</p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" disabled={saving} onClick={closeAfterDispatch}>Close (order saved)</Button>
                <Button onClick={handleRetryDispatch} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Retry dispatch
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">
                Order {dispatchPhase.pending.created.orderNumber} dispatched to Pathao.
              </p>
              <p className="text-xs text-muted-foreground">
                Consignment: <span className="font-mono text-foreground">{dispatchPhase.consignmentId}</span>
                {dispatchPhase.reused && " (this order already had that consignment)"}
              </p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button onClick={closeAfterDispatch}>Done</Button>
              </div>
            </div>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        {/* Issue #29: warn-only duplicate banner. Advisory and dismissible —
            it never blocks or gates saving. */}
        {showDuplicateBanner && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium">Possible duplicate order</p>
                <p className="text-xs text-muted-foreground">
                  A recent order from this customer shares this Brand and at least one product. Review before saving — this warning never blocks saving.
                </p>
                <ul className="space-y-0.5">
                  {(duplicateWarning?.matches ?? []).map((match) => (
                    <li key={match.orderNumber} className="text-xs">
                      <span className="font-medium">#{match.orderNumber}</span>
                      {" · "}
                      {new Date(match.createdAt).toLocaleString()}
                      {" · shared: "}
                      {match.sharedProducts
                        .map((p) => `${p.name}${p.newVariationLabel ? ` (${p.newVariationLabel})` : ""}`)
                        .join(", ")}
                    </li>
                  ))}
                </ul>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                aria-label="Dismiss duplicate warning"
                onClick={() => setDuplicateDismissedKey(duplicateBannerKey)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
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
              variations={variations}
              onSelectProduct={(p) => {
                const productBrand = deriveBrandForProduct(activeBrands, p);
                if (!selectedBrandId && productBrand) setSelectedBrandId(productBrand.id);
                // Resolve variations the same way the database does (trimmed +
                // case-insensitive UUID match) so a variable product never gets
                // added straight to the cart without a size being chosen.
                const productVariations = getProductVariations(p.id, variations);
                if (productVariations.length > 0) {
                   setSelectedProduct(p);
                   setShowVariationModal(true);
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
                        <div className="text-[11px] text-primary mt-1 font-semibold">{symbol}{item.price.toLocaleString()}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center border border-border rounded-md bg-background">
                          <button onClick={() => updateQty(item.uid, item.qty - 1)} className="p-1 hover:bg-muted"><Minus className="h-3 w-3" /></button>
                          <span className="px-2 text-xs font-medium">{item.qty}</span>
                          <button onClick={() => updateQty(item.uid, item.qty + 1)} className="p-1 hover:bg-muted"><Plus className="h-3 w-3" /></button>
                        </div>
                        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive" onClick={() => removeItem(item.uid)} aria-label="Remove item">
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
                <Input
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  onBlur={lookupCustomerByPhone}
                  placeholder="01XXXXXXXXX"
                  className="h-9"
                />
              </div>
            </div>

            {customerMatches.length > 0 && (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-2 space-y-1.5">
                {customerMatches.length === 1 ? (
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 text-xs">
                      <p className="font-medium text-foreground truncate">
                        Existing customer — {customerMatches[0].name || "Unnamed"}
                      </p>
                      <p className="text-muted-foreground">
                        {customerMatches[0].orderCount} previous order{customerMatches[0].orderCount === 1 ? "" : "s"}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs shrink-0"
                      onClick={() => fillFromCustomer(customerMatches[0])}
                    >
                      Fill
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-foreground">
                      {customerMatches.length} customers use this phone — pick one to fill
                    </p>
                    {customerMatches.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between gap-2 rounded border border-border/60 bg-background/60 px-2 py-1"
                      >
                        <div className="min-w-0 text-[11px]">
                          <p className="truncate font-medium text-foreground">{c.name || "Unnamed"}</p>
                          <p className="truncate text-muted-foreground">
                            {c.address || c.city || "No address"} · {c.orderCount} order{c.orderCount === 1 ? "" : "s"}
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs shrink-0"
                          onClick={() => fillFromCustomer(c)}
                        >
                          Fill
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  className="text-[10px] text-muted-foreground hover:underline"
                  onClick={() => setCustomerMatches([])}
                >
                  Dismiss
                </button>
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs">Address</Label>
              <Input value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} placeholder="Full delivery address" className="h-9" />
            </div>

            {/* Pathao Location Dropdowns (More Compact) */}
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px]">City</Label>
                <SearchableSelect
                  options={cityOptions}
                  value={selectedCity?.toString() || (locationHints.city ? `${LOCATION_HINT_PREFIX}${locationHints.city}` : "")}
                  onChange={(v) => {
                    if (v.startsWith(LOCATION_HINT_PREFIX)) {
                      setLocationHints((p) => ({ ...p, city: v.slice(LOCATION_HINT_PREFIX.length), zone: "", area: "" }));
                      setSelectedCity(null);
                    } else {
                      setSelectedCity(Number(v));
                      setLocationHints({ city: "", zone: "", area: "" });
                    }
                    setSelectedZone(null);
                    setSelectedArea(null);
                  }}
                  placeholder="City"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Zone</Label>
                <SearchableSelect
                  options={zoneOptions}
                  value={selectedZone?.toString() || (locationHints.zone ? `${LOCATION_HINT_PREFIX}${locationHints.zone}` : "")}
                  onChange={(v) => {
                    if (v.startsWith(LOCATION_HINT_PREFIX)) {
                      setLocationHints((p) => ({ ...p, zone: v.slice(LOCATION_HINT_PREFIX.length), area: "" }));
                      setSelectedZone(null);
                    } else {
                      setSelectedZone(Number(v));
                      setLocationHints((p) => ({ ...p, zone: "", area: "" }));
                    }
                    setSelectedArea(null);
                  }}
                  placeholder="Zone"
                  className="h-8 text-xs"
                  disabled={!selectedCity && !locationHints.zone}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Area</Label>
                <SearchableSelect
                  options={areaOptions}
                  value={selectedArea?.toString() || (locationHints.area ? `${LOCATION_HINT_PREFIX}${locationHints.area}` : "")}
                  onChange={(v) => {
                    if (v.startsWith(LOCATION_HINT_PREFIX)) {
                      setLocationHints((p) => ({ ...p, area: v.slice(LOCATION_HINT_PREFIX.length) }));
                      setSelectedArea(null);
                    } else {
                      setSelectedArea(Number(v));
                      setLocationHints((p) => ({ ...p, area: "" }));
                    }
                  }}
                  placeholder="Area"
                  className="h-8 text-xs"
                  disabled={!selectedZone && !locationHints.area}
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
            {/* Identity is chosen once in the footer strip (Brand + Order Source).
                The stock store is derived from that identity, so it is shown
                read-only instead of asking for a second, conflicting choice. */}
            <div className="space-y-1">
              <Label className="text-xs">Stock store</Label>
              <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-xs text-muted-foreground">
                <span className="truncate">
                  {stores.find((store) => store.id === storeId)?.name ??
                    (storeId ? "Store unavailable" : "Follows the order source")}
                </span>
              </div>
            </div>
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

          <div className="space-y-1">
            <Label className="text-xs">Payment method</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Select method" /></SelectTrigger>
              <SelectContent>
                {paymentOptions.map((m) => (
                  <SelectItem key={m.code} value={m.code}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              Cash / manual is always available; the other methods follow what the
              selected order source accepts.
            </p>
          </div>

          <div className="rounded-md border border-primary/20 bg-primary/5 p-3 space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
               <span>Subtotal: {symbol}{subtotal.toLocaleString()}</span>
               {discount > 0 && <span>Discount: -{symbol}{discount.toLocaleString()}</span>}
               {shippingCost > 0 && <span>Shipping: {symbol}{shippingCost.toLocaleString()}</span>}
            </div>
            <div className="flex justify-between items-center">
               <span className="text-sm font-semibold">Total to Collect</span>
               <span className="text-lg font-bold text-primary">{symbol}{Math.max(0, total - paidAmount).toLocaleString()}</span>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase">Internal Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="text-xs min-h-[50px]" />
          </div>
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

    <ResponsiveDialog
      open={showVariationModal}
      onOpenChange={setShowVariationModal}
      title={selectedProduct?.name || "Select Variation"}
    >
      <div className="space-y-4 py-4">
        {selectedProductVariations.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {selectedProductVariations.map(v => (
              <Button
                key={v.id}
                variant="outline"
                className="h-auto py-3 px-4 flex flex-col items-start gap-1"
                onClick={() => {
                  addItem({
                    id: v.id,
                    productId: v.product_id,
                    variationId: v.id,
                    name: selectedProduct?.name || "Product",
                    variationLabel: v.name,
                    sku: v.sku || selectedProduct?.sku,
                    price: v.price,
                  });
                  setShowVariationModal(false);
                }}
              >
                <span className="text-sm font-medium">{v.name}</span>
                <span className="text-xs text-primary font-semibold">{symbol}{Number(v.price).toLocaleString()}</span>
              </Button>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-muted-foreground">
            <Tag className="h-8 w-8 mx-auto mb-2 opacity-20" />
            <p className="text-sm">No variations found for this product.</p>
          </div>
        )}
      </div>
    </ResponsiveDialog>
    </>
  );
}


