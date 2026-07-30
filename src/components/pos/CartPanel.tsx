import { useState, useEffect, useMemo, useCallback } from "react";
import { Plus, Printer, FileText, Trash2, Minus, CreditCard, Banknote, Smartphone, Building2, Truck, Store, Search, ShoppingBag, Ruler, X, Check, User, Percent, Edit3, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { printInvoice } from "./InvoicePrint";
import type { Cart, CartItem, Payment, CustomerData } from "./types";
import { useInvoiceSettings } from "@/hooks/useInvoiceSettings";
import { supabase } from "@/integrations/supabase/client";

interface PathaoZone {
  zone_id: number;
  zone_name: string;
  city_id: number;
}

interface PathaoArea {
  area_id: number;
  area_name: string;
  zone_id: number;
}

interface DetectedLocation {
  zone: PathaoZone;
  area?: PathaoArea;
}

interface Props {
  carts: Cart[];
  activeCartId: string;
  onSetActiveCart: (id: string) => void;
  onAddCart: () => void;
  onRemoveCart: (id: string) => void;
  onUpdateCart: (id: string, updates: Partial<Cart>) => void;
  onUpdateItem: (cartId: string, uid: string, updates: Partial<CartItem>) => void;
  onRemoveItem: (cartId: string, uid: string) => void;
  onCompleteOrder: (cart: Cart) => Promise<string>;
  customers: CustomerData[];
  onSearchCustomers: (q: string) => void;
}

const methodIcons: Record<string, React.ReactNode> = {
  cash: <Banknote className="h-4 w-4" />,
  bkash: <Smartphone className="h-4 w-4" />,
  card: <CreditCard className="h-4 w-4" />,
  bank: <Building2 className="h-4 w-4" />,
};

const CartPanel = ({
  carts, activeCartId, onSetActiveCart, onAddCart, onRemoveCart,
  onUpdateCart, onUpdateItem, onRemoveItem, onCompleteOrder,
  customers, onSearchCustomers,
}: Props) => {
  const { settings: invoiceSettings } = useInvoiceSettings();
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [payMethod, setPayMethod] = useState<"cash" | "bkash" | "card" | "bank">("cash");
  const [payAmount, setPayAmount] = useState("");
  const [completedOrderNumber, setCompletedOrderNumber] = useState("");
  const [completedCartSnapshot, setCompletedCartSnapshot] = useState<Cart | null>(null);
  const [newCustName, setNewCustName] = useState("");
  const [newCustPhone, setNewCustPhone] = useState("");
  const [newCustAddress, setNewCustAddress] = useState("");
  const [editingItemPrice, setEditingItemPrice] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState("");

  // Pathao zones & areas
  const [pathaoZones, setPathaoZones] = useState<PathaoZone[]>([]);
  const [pathaoAreas, setPathaoAreas] = useState<PathaoArea[]>([]);
  const [zoneSearch, setZoneSearch] = useState("");
  const [showZoneDropdown, setShowZoneDropdown] = useState(false);
  const [detected, setDetected] = useState<DetectedLocation | null>(null);

  useEffect(() => {
    Promise.all([
      supabase.from("pathao_zones").select("zone_id, zone_name, city_id").order("zone_name"),
      supabase.from("pathao_areas").select("area_id, area_name, zone_id").order("area_name"),
    ]).then(([zonesRes, areasRes]) => {
      setPathaoZones((zonesRes.data || []) as PathaoZone[]);
      setPathaoAreas((areasRes.data || []) as PathaoArea[]);
    });
  }, []);

  const filteredZones = useMemo(() => {
    if (!zoneSearch) return pathaoZones.slice(0, 20);
    const q = zoneSearch.toLowerCase();
    return pathaoZones.filter((z) => z.zone_name.toLowerCase().includes(q)).slice(0, 20);
  }, [pathaoZones, zoneSearch]);

  // --- Pathao location matching (same logic as DispatchDialog) ---
  const LOCATION_WORD_BLACKLIST = useMemo(() => new Set([
    "address", "area", "bari", "bazar", "block", "building", "city", "district", "door", "flat",
    "floor", "gate", "goli", "gram", "house", "lane", "market", "moor", "para", "post", "road",
    "sector", "street", "thana", "union", "upazila", "village", "word", "zilla", "zip",
  ]), []);

  const LOCATION_ALIAS_GROUPS = useMemo(() => [
    ["bbaria", "brahmanbaria"], ["barisal", "barishal"], ["bogra", "bogura"],
    ["chittagong", "chattogram"], ["cumilla", "comilla"], ["jashore", "jessore"],
    ["lakshmipur", "laxmipur", "lokkhipur"], ["munsiganj", "munshiganj"],
    ["narshingdi", "narsingdi"], ["gopalgonj", "gopalganj"],
    ["bashundhara", "basundhara", "bashundhara r/a", "bashundhara residential area", "boshundhora", "boshundhara", "bosundhora"],
    ["mirpur", "mirpur 1", "mirpur 2", "mirpur 10", "mirpur 11", "mirpur 12", "mirpur 13", "mirpur 14"],
    ["uttara", "uttara sector 1", "uttara sector 3", "uttara sector 4", "uttara sector 7", "uttara sector 10", "uttara sector 11", "uttara sector 13", "uttara sector 14"],
    ["dhanmondi", "dhanmondi r/a"],
    ["badda", "middle badda", "merul badda", "north badda", "south badda"],
    ["khilgaon", "khilgaon r/a"],
    ["cantonment", "dhaka cantonment"],
    ["farmgate", "farm gate"],
  ], []);

  const normalizeLocationText = useCallback((v: string) => v.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""), []);

  const getEditDistance = useCallback((a: string, b: string): number => {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix: number[][] = [];
    for (let i = 0; i <= a.length; i++) matrix[i] = [i];
    for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        matrix[i][j] = Math.min(matrix[i-1][j]+1, matrix[i][j-1]+1, matrix[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
    return matrix[a.length][b.length];
  }, []);

  const expandLocationAliases = useCallback((value: string) => {
    const normalized = normalizeLocationText(value);
    const variants = new Set<string>();
    if (!normalized) return variants;
    variants.add(normalized);
    for (const group of LOCATION_ALIAS_GROUPS) {
      const normalizedGroup = group.map((alias) => normalizeLocationText(alias)).filter(Boolean);
      if (normalizedGroup.includes(normalized)) {
        normalizedGroup.forEach((a) => variants.add(a));
      }
    }
    return variants;
  }, [normalizeLocationText, LOCATION_ALIAS_GROUPS]);

  const buildLocationCandidates = useCallback((values: Array<string | null | undefined>) => {
    const candidates: string[] = [];
    const seen = new Set<string>();
    const addCandidate = (v?: string | null) => {
      const trimmed = v?.trim();
      if (!trimmed) return;
      const n = normalizeLocationText(trimmed);
      if (!n || seen.has(n)) return;
      seen.add(n);
      candidates.push(trimmed);
    };
    for (const value of values) {
      if (!value) continue;
      addCandidate(value);
      for (const segment of value.split(/[\n,]/)) {
        const trimmed = segment.trim();
        if (!trimmed) continue;
        addCandidate(trimmed);
        const afterColon = trimmed.includes(":") ? trimmed.split(":").slice(1).join(":").trim() : "";
        addCandidate(afterColon);
        addCandidate(trimmed.replace(/^(?:village|road|house|flat|sector|block|union|upazila|thana|zilla|district|city)\s*:?\s*/i, ""));
        for (const word of trimmed.split(/\s+/)) {
          const nw = normalizeLocationText(word);
          if (nw.length >= 3 && !LOCATION_WORD_BLACKLIST.has(nw) && !/^\d+$/.test(nw)) addCandidate(word);
        }
      }
    }
    return candidates;
  }, [normalizeLocationText, LOCATION_WORD_BLACKLIST]);

  const getStrictLocationMatch = useCallback(<T,>(items: T[], getText: (item: T) => string, queries: string[]): T | undefined => {
    const ranked = items.map((item) => {
      const itemVariants = expandLocationAliases(getText(item));
      let bestScore: number | null = null;
      for (const rawQ of queries) {
        const qVariants = expandLocationAliases(rawQ.trim());
        for (const iv of itemVariants) {
          for (const qv of qVariants) {
            if (!qv || qv.length < 3) continue;
            let score: number | null = null;
            if (iv === qv) score = 0;
            else if (Math.min(iv.length, qv.length) >= 5 && (iv.startsWith(qv) || qv.startsWith(iv))) score = 1;
            else if (Math.min(iv.length, qv.length) >= 5 && (iv.includes(qv) || qv.includes(iv))) score = 2;
            else {
              const d = getEditDistance(iv, qv);
              const th = Math.max(1, Math.floor(Math.max(iv.length, qv.length) * 0.18));
              if (Math.min(iv.length, qv.length) >= 5 && d <= th) score = 10 + d;
            }
            if (score !== null && (bestScore === null || score < bestScore)) bestScore = score;
          }
        }
      }
      return bestScore === null ? null : { item, score: bestScore, text: normalizeLocationText(getText(item)) };
    }).filter((e): e is { item: T; score: number; text: string } => e !== null)
      .sort((a, b) => a.score - b.score || a.text.localeCompare(b.text));
    if (ranked.length === 0) return undefined;
    if (ranked.length > 1 && ranked[0].score === ranked[1].score) return undefined;
    return ranked[0].item;
  }, [expandLocationAliases, getEditDistance, normalizeLocationText]);

  const fuzzyMatch = useCallback(<T,>(items: T[], getText: (item: T) => string, queries: string[]): T | undefined => {
    for (const rawQ of queries) {
      const q = normalizeLocationText(rawQ);
      if (!q) continue;
      let best = items.find((item) => normalizeLocationText(getText(item)) === q);
      if (best) return best;
      best = items.find((item) => { const v = normalizeLocationText(getText(item)); return v.startsWith(q) || q.startsWith(v); });
      if (best) return best;
      best = items.find((item) => { const v = normalizeLocationText(getText(item)); return v.includes(q) || q.includes(v); });
      if (best) return best;
      let minD = Infinity; let closest: T | undefined;
      for (const item of items) {
        const d = getEditDistance(q, normalizeLocationText(getText(item)));
        const th = Math.max(2, Math.floor(q.length * 0.35));
        if (d < minD && d <= th) { minD = d; closest = item; }
      }
      if (closest) return closest;
    }
    return undefined;
  }, [getEditDistance, normalizeLocationText]);

  // Auto-detect zone + area globally from address (no city required).
  // Tries area first (most specific), back-filling its zone; otherwise zone.
  const autoDetectZone = useCallback((address: string) => {
    if (!address || address.length < 3 || pathaoZones.length === 0) { setDetected(null); return; }
    const candidates = buildLocationCandidates([address]);

    const areaMatch = getStrictLocationMatch(pathaoAreas, (a) => a.area_name, candidates);
    if (areaMatch) {
      const parentZone = pathaoZones.find((z) => z.zone_id === areaMatch.zone_id);
      if (parentZone) { setDetected({ zone: parentZone, area: areaMatch }); return; }
    }

    const zoneMatch =
      getStrictLocationMatch(pathaoZones, (z) => z.zone_name, candidates) ||
      fuzzyMatch(pathaoZones, (z) => z.zone_name, candidates);
    if (zoneMatch) {
      // Try to refine with an area inside this zone
      const zoneAreas = pathaoAreas.filter((a) => a.zone_id === zoneMatch.zone_id);
      const areaInZone = fuzzyMatch(zoneAreas, (a) => a.area_name, candidates);
      setDetected({ zone: zoneMatch, area: areaInZone });
      return;
    }

    setDetected(null);
  }, [pathaoZones, pathaoAreas, buildLocationCandidates, getStrictLocationMatch, fuzzyMatch]);

  const cart = carts.find((c) => c.id === activeCartId) || carts[0];
  if (!cart) return null;

  const QUICK_CASH = [500, 1000, 2000, 5000];
  const shippingPresets = invoiceSettings?.shipping_presets || [80, 150];

  // Calculate totals with per-item discounts
  const subtotal = cart.items.reduce((s, i) => {
    const lineTotal = i.price * i.qty;
    const itemDiscount = i.discountType === "percent"
      ? lineTotal * (i.discountValue || 0) / 100
      : (i.discountValue || 0);
    return s + lineTotal - itemDiscount;
  }, 0);

  const cartDiscount = cart.discountType === "percent"
    ? subtotal * cart.discount / 100
    : cart.discount;

  const afterDiscount = subtotal - cartDiscount;
  const taxAmount = afterDiscount * cart.taxRate / 100;
  const total = afterDiscount + taxAmount + (cart.fulfillment === "delivery" ? cart.shippingFee : 0);
  const totalPaid = cart.payments.reduce((s, p) => s + p.amount, 0);
  const balance = total - totalPaid;

  const validatePhone = (value: string) => {
    const digits = value.replace(/\D/g, "");
    if (digits.length > 0 && digits.length !== 11) {
      setPhoneError("Phone must be 11 digits");
    } else if (digits.length > 0 && !/^\d{11}$/.test(digits)) {
      setPhoneError("Only numbers allowed");
    } else {
      setPhoneError("");
    }
    return digits;
  };

  const addPayment = () => {
    const amt = parseFloat(payAmount);
    if (!amt || amt <= 0) return;
    const p: Payment = { id: crypto.randomUUID(), method: payMethod, amount: amt };
    onUpdateCart(cart.id, { payments: [...cart.payments, p] });
    setPayAmount("");
  };

  const addQuickCash = (amount: number) => {
    const p: Payment = { id: crypto.randomUUID(), method: "cash", amount };
    onUpdateCart(cart.id, { payments: [...cart.payments, p] });
  };

  const addExactCash = () => {
    if (balance <= 0) return;
    const p: Payment = { id: crypto.randomUUID(), method: payMethod, amount: Math.ceil(balance) };
    onUpdateCart(cart.id, { payments: [...cart.payments, p] });
  };

  const removePayment = (pid: string) => {
    onUpdateCart(cart.id, { payments: cart.payments.filter((p) => p.id !== pid) });
  };

  const handleComplete = async () => {
    if (newCustPhone && !/^\d{11}$/.test(newCustPhone.replace(/\D/g, ""))) {
      setPhoneError("Phone must be exactly 11 digits");
      return;
    }

    if (!cart.customer && newCustName) {
      const custData: CustomerData = {
        name: newCustName,
        phone: newCustPhone,
        address: newCustAddress || undefined,
      };
      onUpdateCart(cart.id, { customer: custData });
    }

    const snapshot = { ...cart, customer: cart.customer || (newCustName ? { name: newCustName, phone: newCustPhone, address: newCustAddress || undefined } : null) };
    setCompletedCartSnapshot(snapshot);
    const orderNum = await onCompleteOrder(snapshot);
    setCompletedOrderNumber(orderNum);

    const fmt = invoiceSettings?.default_print_format || "thermal";
    const sub = snapshot.items.reduce((s, i) => s + i.price * i.qty, 0);
    const tot = sub - snapshot.discount + (snapshot.fulfillment === "delivery" ? snapshot.shippingFee : 0);
    printInvoice({ orderNumber: orderNum, cart: snapshot, subtotal: sub, total: tot, invoiceSettings }, fmt);

    setNewCustName("");
    setNewCustPhone("");
    setNewCustAddress("");
    setCustomerSearch("");
    setPhoneError("");
    setDetected(null);
  };

  const selectCustomer = (c: CustomerData) => {
    onUpdateCart(cart.id, { customer: c });
    setNewCustName(c.name);
    setNewCustPhone(c.phone);
    setNewCustAddress(c.address || "");
    setCustomerSearch("");
    setShowCustomerDropdown(false);
    if (c.address) autoDetectZone(c.address);
  };

  const clearCustomer = () => {
    onUpdateCart(cart.id, { customer: null });
    setNewCustName("");
    setNewCustPhone("");
    setNewCustAddress("");
    setCustomerSearch("");
    setPhoneError("");
    setDetected(null);
  };

  const handlePrint = (format: "thermal" | "a4") => {
    if (completedCartSnapshot) {
      const snap = completedCartSnapshot;
      const sub = snap.items.reduce((s, i) => s + i.price * i.qty, 0);
      const tot = sub - snap.discount + (snap.fulfillment === "delivery" ? snap.shippingFee : 0);
      printInvoice({ orderNumber: completedOrderNumber, cart: snap, subtotal: sub, total: tot, invoiceSettings }, format);
    }
  };

  const getItemLineTotal = (item: CartItem) => {
    const lineTotal = item.price * item.qty;
    const itemDiscount = item.discountType === "percent"
      ? lineTotal * (item.discountValue || 0) / 100
      : (item.discountValue || 0);
    return lineTotal - itemDiscount;
  };

  return (
    <>
      <div className="flex flex-col h-full bg-card">
        {/* Multi-Cart Tabs */}
        <div className="border-b border-border px-3 pt-3">
          <div className="flex items-center gap-1 overflow-x-auto pb-2">
            {carts.map((c) => (
              <button
                key={c.id}
                onClick={() => onSetActiveCart(c.id)}
                className={`shrink-0 relative group flex items-center gap-1.5 rounded-t-md px-3 py-2 text-sm font-medium transition-colors ${
                  c.id === activeCartId
                    ? "bg-background text-foreground border border-b-0 border-border"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <ShoppingBag className="h-3.5 w-3.5" />
                {c.label}
                {c.items.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{c.items.length}</Badge>
                )}
                {carts.length > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemoveCart(c.id); }}
                    className="ml-1 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </button>
            ))}
            <button
              onClick={onAddCart}
              className="shrink-0 h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Customer Info */}
        <div className="border-b border-border p-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="relative">
              <Input
                value={newCustName || customerSearch}
                onChange={(e) => {
                  const val = e.target.value;
                  setNewCustName(val);
                  setCustomerSearch(val);
                  onSearchCustomers(val);
                  setShowCustomerDropdown(true);
                  if (!val) clearCustomer();
                }}
                onFocus={() => { if (newCustName) setShowCustomerDropdown(true); }}
                onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 200)}
                placeholder="Customer name *"
                className="h-9 text-sm bg-secondary"
              />
              {showCustomerDropdown && (customerSearch || newCustPhone) && customers.length > 0 && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-md border border-border bg-popover shadow-lg max-h-40 overflow-y-auto">
                  {customers.map((c) => (
                    <button
                      key={c.id || c.phone}
                      onClick={() => selectCustomer(c)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
                    >
                      <span className="font-medium">{c.name}</span>
                      <span className="text-muted-foreground ml-2">{c.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <Input
                value={newCustPhone}
                onChange={(e) => {
                  const raw = e.target.value.replace(/\D/g, "").slice(0, 11);
                  setNewCustPhone(raw);
                  validatePhone(raw);
                  if (raw.length >= 3) {
                    onSearchCustomers(raw);
                    setShowCustomerDropdown(true);
                  }
                }}
                placeholder="Phone number (11 digits) *"
                className={`h-9 text-sm bg-secondary ${phoneError ? "border-destructive" : ""}`}
                maxLength={11}
              />
              {phoneError && <p className="text-[10px] text-destructive mt-0.5">{phoneError}</p>}
            </div>
          </div>

          {cart.customer && (
            <div className="flex items-center justify-between rounded-md bg-primary/10 border border-primary/20 px-3 py-1.5">
              <div className="flex items-center gap-2 text-sm">
                <User className="h-3.5 w-3.5 text-primary" />
                <span className="font-medium text-primary">{cart.customer.name}</span>
                <span className="text-muted-foreground">{cart.customer.phone}</span>
              </div>
              <button onClick={clearCustomer} className="text-muted-foreground hover:text-destructive">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <div className="flex rounded-md border border-border overflow-hidden">
            {([
              { key: "walkin" as const, label: "Walk-In", icon: User },
              { key: "pickup" as const, label: "Pickup", icon: Store },
              { key: "delivery" as const, label: "Delivery", icon: Truck },
            ]).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => onUpdateCart(cart.id, { fulfillment: key })}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors ${
                  cart.fulfillment === key ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>

          {cart.fulfillment === "delivery" && (
            <div className="space-y-2">
              <Input
                value={newCustAddress}
                onChange={(e) => {
                  setNewCustAddress(e.target.value);
                  autoDetectZone(e.target.value);
                }}
                placeholder="Shipping address *"
                className="h-9 text-sm bg-secondary"
              />
              {/* Auto-detected zone/area hint */}
              {detected && !cart.pathaoZone && (
                <button
                  onClick={() => {
                    onUpdateCart(cart.id, {
                      pathaoZone: detected.zone.zone_name,
                      pathaoZoneId: detected.zone.zone_id,
                      pathaoCityId: detected.zone.city_id,
                      pathaoAreaId: detected.area?.area_id,
                    });
                    setZoneSearch("");
                  }}
                  className="w-full text-left rounded-md bg-primary/10 border border-primary/20 px-3 py-1.5 text-xs text-primary hover:bg-primary/15 transition-colors"
                >
                  🎯 Detected: <strong>{detected.zone.zone_name}</strong>
                  {detected.area && <> · <strong>{detected.area.area_name}</strong></>} — click to apply
                </button>
              )}
              {/* Pathao Zone Searchable */}
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={zoneSearch || cart.pathaoZone}
                  onChange={(e) => {
                    setZoneSearch(e.target.value);
                    setShowZoneDropdown(true);
                    if (!e.target.value) onUpdateCart(cart.id, { pathaoZone: "" });
                  }}
                  onFocus={() => setShowZoneDropdown(true)}
                  onBlur={() => setTimeout(() => setShowZoneDropdown(false), 200)}
                  placeholder="Search Pathao zone..."
                  className="h-9 text-sm bg-secondary pl-9"
                />
                {showZoneDropdown && filteredZones.length > 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-md border border-border bg-popover shadow-lg max-h-40 overflow-y-auto">
                    {filteredZones.map((z) => (
                      <button
                        key={z.zone_id}
                        onClick={() => {
                          onUpdateCart(cart.id, { 
                            pathaoZone: z.zone_name,
                            pathaoZoneId: z.zone_id,
                            pathaoCityId: z.city_id,
                          });
                          setZoneSearch("");
                          setShowZoneDropdown(false);
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
                      >
                        {z.zone_name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Cart Items */}
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-2">
            {cart.items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <ShoppingBag className="h-10 w-10 mb-2 opacity-30" />
                <p className="text-sm">Cart is empty</p>
                <p className="text-xs mt-1">Scan a barcode or click a product</p>
              </div>
            ) : (
              cart.items.map((item) => (
                <div key={item.uid} className="rounded-md border border-border bg-secondary/50 p-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.name}</p>
                      {item.variationLabel && (
                        <p className="text-xs text-muted-foreground">{item.variationLabel}</p>
                      )}
                      {item.customTailoring && (
                        <Badge variant="outline" className="mt-1 text-[10px] gap-1">
                          <Ruler className="h-3 w-3" /> Custom
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {/* Inline price edit */}
                      <Popover open={editingItemPrice === item.uid} onOpenChange={(v) => setEditingItemPrice(v ? item.uid : null)}>
                        <PopoverTrigger asChild>
                          <button className="text-muted-foreground hover:text-foreground p-1" title="Edit price">
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-52 p-3 space-y-2" align="end">
                          <Label className="text-xs">Unit Price (৳)</Label>
                          <Input
                            type="number"
                            defaultValue={item.price}
                            onChange={(e) => {
                              const newPrice = parseFloat(e.target.value);
                              if (newPrice > 0) {
                                onUpdateItem(cart.id, item.uid, { price: newPrice, originalPrice: item.originalPrice || item.price });
                              }
                            }}
                            className="h-8 text-sm bg-secondary"
                          />
                          <div className="flex gap-2">
                            <div className="flex-1">
                              <Label className="text-xs">Discount</Label>
                              <Input
                                type="number"
                                value={item.discountValue || ""}
                                onChange={(e) => onUpdateItem(cart.id, item.uid, { discountValue: parseFloat(e.target.value) || 0 })}
                                placeholder="0"
                                className="h-8 text-sm bg-secondary"
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Type</Label>
                              <Select
                                value={item.discountType || "flat"}
                                onValueChange={(v) => onUpdateItem(cart.id, item.uid, { discountType: v as "flat" | "percent" })}
                              >
                                <SelectTrigger className="h-8 w-16 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="flat">৳</SelectItem>
                                  <SelectItem value="percent">%</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          {item.originalPrice && item.price !== item.originalPrice && (
                            <p className="text-[10px] text-muted-foreground">Original: ৳{item.originalPrice.toLocaleString()}</p>
                          )}
                        </PopoverContent>
                      </Popover>
                      <button onClick={() => onRemoveItem(cart.id, item.uid)} className="text-muted-foreground hover:text-destructive p-1">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center border border-border rounded-md bg-card">
                      <button onClick={() => onUpdateItem(cart.id, item.uid, { qty: Math.max(1, item.qty - 1) })} className="px-2 py-1 text-xs hover:bg-muted">
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="px-2.5 py-1 text-xs font-medium border-x border-border min-w-[1.5rem] text-center">{item.qty}</span>
                      <button onClick={() => onUpdateItem(cart.id, item.uid, { qty: item.qty + 1 })} className="px-2 py-1 text-xs hover:bg-muted">
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold font-heading">৳{getItemLineTotal(item).toLocaleString()}</p>
                      {(item.discountValue || 0) > 0 && (
                        <p className="text-[10px] text-destructive">-{item.discountType === "percent" ? `${item.discountValue}%` : `৳${item.discountValue}`}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>

        {/* Checkout Section */}
        <div className="border-t border-border p-3 space-y-3">
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span>৳{subtotal.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Discount</span>
              <div className="flex items-center gap-1">
                <Select
                  value={cart.discountType}
                  onValueChange={(v) => onUpdateCart(cart.id, { discountType: v as "flat" | "percent" })}
                >
                  <SelectTrigger className="h-7 w-14 text-xs bg-secondary border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="flat">৳</SelectItem>
                    <SelectItem value="percent">%</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  value={cart.discount || ""}
                  onChange={(e) => onUpdateCart(cart.id, { discount: parseFloat(e.target.value) || 0 })}
                  placeholder="0"
                  className="h-7 w-20 text-right text-sm bg-secondary"
                />
              </div>
            </div>
            {cartDiscount > 0 && cart.discountType === "percent" && (
              <div className="flex justify-between text-xs text-destructive">
                <span></span>
                <span>-৳{cartDiscount.toLocaleString()}</span>
              </div>
            )}

            {/* Tax */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Tax (%)</span>
              <Input
                type="number"
                value={cart.taxRate || ""}
                onChange={(e) => onUpdateCart(cart.id, { taxRate: parseFloat(e.target.value) || 0 })}
                placeholder="0"
                className="h-7 w-20 text-right text-sm bg-secondary"
              />
            </div>
            {taxAmount > 0 && (
              <div className="flex justify-between text-xs">
                <span></span>
                <span>+৳{taxAmount.toLocaleString()}</span>
              </div>
            )}

            {cart.fulfillment === "delivery" && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Shipping</span>
                  <div className="flex items-center gap-1">
                    {shippingPresets.map((amt) => (
                      <Button
                        key={amt}
                        variant={cart.shippingFee === amt ? "default" : "outline"}
                        size="sm"
                        className="h-7 text-xs px-2"
                        onClick={() => onUpdateCart(cart.id, { shippingFee: amt })}
                      >
                        ৳{amt}
                      </Button>
                    ))}
                    <Input
                      type="number"
                      value={cart.shippingFee || ""}
                      onChange={(e) => onUpdateCart(cart.id, { shippingFee: parseFloat(e.target.value) || 0 })}
                      placeholder="0"
                      className="h-7 w-20 text-right text-sm bg-secondary"
                    />
                  </div>
                </div>
              </>
            )}
            <div className="flex justify-between font-semibold text-base pt-1 border-t border-border">
              <span>Total</span>
              <span className="font-heading">৳{total.toLocaleString()}</span>
            </div>
          </div>

          {/* Quick Cash Buttons */}
          <div className="flex gap-1.5 flex-wrap">
            {QUICK_CASH.map((amt) => (
              <Button
                key={amt}
                variant="outline"
                size="sm"
                className="h-8 text-xs flex-1 min-w-0"
                onClick={() => addQuickCash(amt)}
              >
                ৳{amt.toLocaleString()}
              </Button>
            ))}
            <Button
              variant="secondary"
              size="sm"
              className="h-8 text-xs flex-1 min-w-0"
              onClick={addExactCash}
              disabled={balance <= 0}
            >
              Exact
            </Button>
          </div>

          {/* Split Payments */}
          <div className="space-y-2">
            {cart.payments.length > 0 && (
              <div className="space-y-1">
                {cart.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-md bg-secondary px-3 py-1.5 text-sm">
                    <div className="flex items-center gap-2">
                      {methodIcons[p.method]}
                      <span className="capitalize">{p.method}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">৳{p.amount.toLocaleString()}</span>
                      <button onClick={() => removePayment(p.id)} className="text-muted-foreground hover:text-destructive">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <Select value={payMethod} onValueChange={(v) => setPayMethod(v as typeof payMethod)}>
                <SelectTrigger className="h-9 w-28 bg-secondary text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="bkash">bKash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="bank">Bank</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addPayment()}
                placeholder="Amount"
                className="h-9 flex-1 text-sm bg-secondary"
              />
              <Button variant="secondary" size="sm" onClick={addPayment} className="h-9">
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {/* Balance / Change */}
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-md bg-secondary p-2">
                <p className="text-muted-foreground">Due</p>
                <p className="font-semibold font-heading text-sm">৳{total.toLocaleString()}</p>
              </div>
              <div className="rounded-md bg-secondary p-2">
                <p className="text-muted-foreground">Paid</p>
                <p className="font-semibold font-heading text-sm text-primary">৳{totalPaid.toLocaleString()}</p>
              </div>
              <div className="rounded-md bg-secondary p-2">
                <p className="text-muted-foreground">{balance > 0 ? "Balance" : "Change"}</p>
                <p className={`font-semibold font-heading text-sm ${balance > 0 ? "text-destructive" : "text-primary"}`}>
                  ৳{Math.abs(balance).toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          {/* Notes */}
          <Textarea
            value={cart.notes}
            onChange={(e) => onUpdateCart(cart.id, { notes: e.target.value })}
            placeholder="Order notes..."
            className="text-sm bg-secondary min-h-[40px] h-10"
          />

          {/* Complete */}
          <Button
            onClick={handleComplete}
            disabled={cart.items.length === 0}
            className="w-full h-14 text-lg font-semibold gap-2"
          >
            <Check className="h-5 w-5" />
            {balance > 0 ? `Complete with ৳${balance.toLocaleString()} Due` : `Complete — ৳${total.toLocaleString()}`}
            {balance < 0 && <span className="text-sm opacity-80">(Change: ৳{Math.abs(balance).toLocaleString()})</span>}
          </Button>
        </div>
      </div>

    </>
  );
};

export default CartPanel;
