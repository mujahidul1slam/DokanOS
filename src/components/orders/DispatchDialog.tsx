import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Send, Loader2, AlertTriangle, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import {
  courierProviderInfo,
  courierServiceIntegrationId,
  courierProviderLabel,
  type CourierServiceRow,
} from "@/lib/courierServices";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/hooks/useCurrency";
import {
  isAccountOverride,
  groupOrdersForDispatch,
  type DispatchBrandGroup,
  type DispatchOrderIdentity,
  type PathaoAccountOption,
  type PathaoStoreLinkRow,
} from "@/lib/dispatchAccounts";
import {
  fetchDispatchOrderIdentity,
  fetchPathaoAccountData,
  recordPathaoAccountOverride,
} from "@/lib/dispatchAccountsData";
import { splitGatedOrders, gateLockedMessage } from "@/lib/paymentGateWiring";
import {
  BatchOrderChip,
  BrandAvatar,
  IdentitySegment,
  IdentityStripCard,
  PathaoMark,
  StripWarning,
} from "@/lib/identityStrip";

interface DispatchOrder {
  id: string;
  order_number: string;
  total: number;
  itemCount: number;
  status: string | null;
  consignment_id?: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  customer_city: string | null;
  pathao_recipient_city: number | null;
  pathao_recipient_zone: number | null;
  pathao_recipient_area: number | null;
  amount_to_collect: number | null;
  item_weight: number | null;
  special_instruction: string | null;
  /** Legacy Woo store binding — fallback for the brand default lookup. */
  store_id?: string | null;
}

interface City { city_id: number; city_name: string }
interface Zone { zone_id: number; zone_name: string; city_id: number }
interface Area { area_id: number; area_name: string }

const LOCATION_WORD_BLACKLIST = new Set([
  "address", "area", "bari", "bazar", "block", "building", "city", "district", "door", "flat",
  "floor", "gate", "goli", "gram", "house", "lane", "market", "moor", "para", "post", "road",
  "sector", "street", "thana", "union", "upazila", "village", "word", "zilla", "zip",
]);

const LOCATION_ALIAS_GROUPS = [
  ["bbaria", "brahmanbaria"],
  ["barisal", "barishal"],
  ["bogra", "bogura"],
  ["chittagong", "chattogram"],
  ["cumilla", "comilla"],
  ["jashore", "jessore"],
  ["lakshmipur", "laxmipur", "lokkhipur"],
  ["munsiganj", "munshiganj"],
  ["narshingdi", "narsingdi"],
  ["gopalgonj", "gopalganj"],
  ["bashundhara", "basundhara", "bashundhara r/a", "bashundhara residential area", "boshundhora", "boshundhara", "bosundhora"],
  ["mirpur", "mirpur 1", "mirpur 2", "mirpur 10", "mirpur 11", "mirpur 12", "mirpur 13", "mirpur 14"],
  ["uttara", "uttara sector 1", "uttara sector 3", "uttara sector 4", "uttara sector 7", "uttara sector 10", "uttara sector 11", "uttara sector 13", "uttara sector 14"],
  ["dhanmondi", "dhanmondi r/a"],
  ["badda", "middle badda", "merul badda", "north badda", "south badda"],
  ["khilgaon", "khilgaon r/a"],
  ["cantonment", "dhaka cantonment"],
  ["farmgate", "farm gate"],
];

interface DispatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orders: DispatchOrder[];
  onDispatched: () => void;
  /**
   * Remove one order from the CURRENT batch only (no order, payment, status or
   * consignment changes). The parent deselects the order; the dialog drops it
   * locally even when this is not wired. Optional — no confirmation is shown.
   */
  onRemoveOrder?: (orderId: string) => void;
}

export default function DispatchDialog({ open, onOpenChange, orders, onDispatched, onRemoveOrder }: DispatchDialogProps) {
  const { symbol } = useCurrency();
  const { active, brands } = useBusinessContext();
  const [dispatching, setDispatching] = useState(false);

  // "This order already has a courier entry" confirm-replace dialog.
  const [existingOrders, setExistingOrders] = useState<DispatchOrder[]>([]);
  const [replaceOrderIds, setReplaceOrderIds] = useState<Set<string>>(new Set());
  // Business-level courier service (spec §4): the picker gates the dispatch
  // button; each brand/account group's Pathao Account still owns the booking.
  const [courierServices, setCourierServices] = useState<CourierServiceRow[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [cities, setCities] = useState<City[]>([]);
  const [allZones, setAllZones] = useState<Zone[]>([]);
  const [zonesMap, setZonesMap] = useState<Record<number, Zone[]>>({});
  const [areasMap, setAreasMap] = useState<Record<number, Area[]>>({});
  const [orderOverrides, setOrderOverrides] = useState<Record<string, {
    city_id: string; zone_id: string; area_id: string;
    amount_to_collect: string; item_weight: string; special_instruction: string;
    recipient_name: string; recipient_phone: string; recipient_address: string;
  }>>({});
  // Branded Pathao Account dispatch (issue #22): account options + per-brand
  // default links, per-order identity, batch-only removals, and per-group
  // account overrides. An override lives only for this dialog session — every
  // dispatch starts from the default, never the last manual choice.
  const [accountOptions, setAccountOptions] = useState<PathaoAccountOption[]>([]);
  const [storeLinks, setStoreLinks] = useState<PathaoStoreLinkRow[]>([]);
  const [identityMap, setIdentityMap] = useState<Record<string, DispatchOrderIdentity>>({});
  const [removedOrderIds, setRemovedOrderIds] = useState<Set<string>>(new Set());
  const [groupAccountKeys, setGroupAccountKeys] = useState<Record<string, string>>({});
  const [overrideDismissed, setOverrideDismissed] = useState<Set<string>>(new Set());
  const autoFilledKeyRef = useRef<string>("");
  const dispatchableOrderIdsRef = useRef<Set<string> | null>(null);
  const { toast } = useToast();

  // Batch-only removal (issue #22): drops an order from THIS dispatch batch
  // without any order, payment, status or consignment change. No confirmation.
  const visibleOrders = useMemo(
    () => orders.filter((o) => !removedOrderIds.has(o.id)),
    [orders, removedOrderIds],
  );

  const identityForOrder = useCallback(
    (o: DispatchOrder): DispatchOrderIdentity =>
      identityMap[o.id] ?? {
        id: o.id,
        brandId: null,
        brandName: null,
        brandLogoUrl: null,
        brandWooStoreId: null,
        orderSourceName: null,
        legacyStoreId: o.store_id ?? null,
      },
    [identityMap],
  );

  // Auto-group the batch per brand/account; each group gets its own
  // overrideable Pathao Account selector (issue #22).
  const groups = useMemo(
    () => groupOrdersForDispatch(visibleOrders.map(identityForOrder), storeLinks, accountOptions),
    [visibleOrders, identityForOrder, storeLinks, accountOptions],
  );

  const accountKeyForGroup = (group: DispatchBrandGroup) =>
    groupAccountKeys[group.key] ?? group.defaultAccountKey ?? "";
  const accountForGroup = (group: DispatchBrandGroup) =>
    accountOptions.find((account) => account.key === accountKeyForGroup(group)) ?? null;

  const handleRemoveOrder = (orderId: string) => {
    // Batch-only and immediate — the parent deselects the order when
    // onRemoveOrder is wired; the dialog drops it locally regardless.
    setRemovedOrderIds((prev) => new Set(prev).add(orderId));
    onRemoveOrder?.(orderId);
  };

  const ordersWithExisting = visibleOrders.filter(
    (o) => !!o.consignment_id && String(o.consignment_id).trim() !== "",
  );
  const existingConfirmOpen = existingOrders.length > 0;
  const skipCount = existingOrders.length - replaceOrderIds.size;

  // Reset auto-fill guard whenever the dialog closes so reopening triggers it again.
  useEffect(() => {
    if (!open) {
      autoFilledKeyRef.current = "";
      setExistingOrders([]);
      // Batch-only removals and account overrides never leak into the next
      // dispatch — each dispatch starts from the default (issue #22).
      setRemovedOrderIds(new Set());
      setGroupAccountKeys({});
      setOverrideDismissed(new Set());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    (async () => {
      const [accountData, { data: citiesData }, { data: zonesData }, { data: services }] = await Promise.all([
        fetchPathaoAccountData(),
        supabase.from("pathao_cities").select("city_id, city_name").order("city_name"),
        supabase.from("pathao_zones").select("zone_id, zone_name, city_id").order("zone_name"),
        active
          ? supabase.from("courier_services").select("*").eq("business_id", active.id).eq("is_active", true).order("name")
          : Promise.resolve({ data: [] }),
      ]);
      if (!mounted) return;
      setAccountOptions(accountData.accounts);
      setStoreLinks(accountData.links);
      setCities(citiesData || []);
      setAllZones(zonesData || []);
      const serviceRows = (services || []) as CourierServiceRow[];
      setCourierServices(serviceRows);
      // Dispatch defaults to the business's first Pathao-capable service.
      if (serviceRows.length > 0) {
        const preferred = serviceRows.find((s) => courierServiceIntegrationId(s) !== null || s.provider === "pathao");
        const defaultServiceId = (preferred ?? serviceRows[0]).id;
        setSelectedServiceId((prev) => prev || defaultServiceId);
      }
    })();
    return () => { mounted = false; };
  }, [open, active]);

  // Per-order Brand/Selling Point identity for the auto-grouped dispatch.
  useEffect(() => {
    if (!open || orders.length === 0) return;
    let mounted = true;
    fetchDispatchOrderIdentity(orders.map((o) => o.id), brands).then((identities) => {
      if (!mounted) return;
      setIdentityMap(Object.fromEntries(identities.map((identity) => [identity.id, identity])));
    });
    return () => { mounted = false; };
  }, [open, orders, brands]);

  const normalizeLocationText = useCallback((value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""), []);

  const getEditDistance = useCallback((a: string, b: string): number => {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix: number[][] = [];
    for (let i = 0; i <= a.length; i += 1) matrix[i] = [i];
    for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;

    for (let i = 1; i <= a.length; i += 1) {
      for (let j = 1; j <= b.length; j += 1) {
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
      }
    }

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
        normalizedGroup.forEach((alias) => variants.add(alias));
      }
    }

    return variants;
  }, [normalizeLocationText]);

  const buildLocationCandidates = useCallback((values: Array<string | null | undefined>, options?: { includeWords?: boolean }) => {
    const candidates: string[] = [];
    const seen = new Set<string>();
    const includeWords = options?.includeWords ?? true;

    const addCandidate = (value?: string | null) => {
      const trimmed = value?.trim();
      if (!trimmed) return;
      const normalized = normalizeLocationText(trimmed);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      candidates.push(trimmed);
    };

    for (const value of values) {
      if (!value) continue;
      addCandidate(value);

      for (const segment of value.split(/[\n,]/)) {
        const trimmed = segment.trim();
        if (!trimmed) continue;

        addCandidate(trimmed);

        const afterColon = trimmed.includes(":")
          ? trimmed.split(":").slice(1).join(":").trim()
          : "";
        addCandidate(afterColon);

        addCandidate(
          trimmed.replace(
            /^(?:village|road|house|flat|sector|block|union|upazila|thana|zilla|district|city)\s*:?\s*/i,
            "",
          ),
        );

        if (includeWords) {
          for (const word of trimmed.split(/\s+/)) {
            const normalizedWord = normalizeLocationText(word);
            if (
              normalizedWord.length >= 3
              && !LOCATION_WORD_BLACKLIST.has(normalizedWord)
              && !/^\d+$/.test(normalizedWord)
            ) {
              addCandidate(word);
            }
          }
        }
      }
    }

    return candidates;
  }, [normalizeLocationText]);

  const getStrictLocationMatch = useCallback(<T,>(
    items: T[],
    getText: (item: T) => string,
    queries: string | string[],
  ): T | undefined => {
    const queryList = (Array.isArray(queries) ? queries : [queries]).filter(Boolean);

    const ranked = items
      .map((item) => {
        const itemText = getText(item);
        const itemVariants = expandLocationAliases(itemText);
        let bestScore: number | null = null;

        for (const rawQuery of queryList) {
          const trimmedQuery = rawQuery.trim();
          if (!trimmedQuery) continue;

          const queryVariants = expandLocationAliases(trimmedQuery);

          for (const itemValue of itemVariants) {
            for (const queryValue of queryVariants) {
              if (!queryValue || queryValue.length < 3) continue;

              let score: number | null = null;

              if (itemValue === queryValue) {
                score = 0;
              } else if (
                Math.min(itemValue.length, queryValue.length) >= 5
                && (itemValue.startsWith(queryValue) || queryValue.startsWith(itemValue))
              ) {
                score = 1;
              } else if (
                Math.min(itemValue.length, queryValue.length) >= 5
                && (itemValue.includes(queryValue) || queryValue.includes(itemValue))
              ) {
                score = 2;
              } else {
                const distance = getEditDistance(itemValue, queryValue);
                const threshold = Math.max(1, Math.floor(Math.max(itemValue.length, queryValue.length) * 0.18));
                if (Math.min(itemValue.length, queryValue.length) >= 5 && distance <= threshold) {
                  score = 10 + distance;
                }
              }

              if (score !== null && (bestScore === null || score < bestScore)) {
                bestScore = score;
              }
            }
          }
        }

        return bestScore === null ? null : { item, score: bestScore, text: normalizeLocationText(itemText) };
      })
      .filter((entry): entry is { item: T; score: number; text: string } => entry !== null)
      .sort((a, b) => a.score - b.score || a.text.localeCompare(b.text));

    if (ranked.length === 0) return undefined;
    if (ranked.length > 1 && ranked[0].score === ranked[1].score) return undefined;

    return ranked[0].item;
  }, [expandLocationAliases, getEditDistance, normalizeLocationText]);



  const zonesPromiseCache = useRef<Record<number, Promise<Zone[]>>>({});
  const areasPromiseCache = useRef<Record<number, Promise<Area[]>>>({});

  const fetchZones = useCallback(async (cityId: number): Promise<Zone[]> => {
    if (zonesMap[cityId]?.length) return zonesMap[cityId];
    if (zonesPromiseCache.current[cityId]) return zonesPromiseCache.current[cityId];

    zonesPromiseCache.current[cityId] = (async () => {
      const { data: cached } = await supabase
        .from("pathao_zones")
        .select("zone_id, zone_name, city_id")
        .eq("city_id", cityId)
        .order("zone_name");

      if (cached?.length) {
        setZonesMap((prev) => ({ ...prev, [cityId]: cached }));
        return cached;
      }

      const { data } = await supabase.functions.invoke("pathao-courier", { body: { action: "get_zones", city_id: cityId } });
      const zones = (data?.data || []).map((zone: any) => ({ zone_id: zone.zone_id, zone_name: zone.zone_name, city_id: zone.city_id ?? cityId }));
      setZonesMap((prev) => ({ ...prev, [cityId]: zones }));
      return zones;
    })();

    return zonesPromiseCache.current[cityId];
  }, [zonesMap]);

  const fetchAreas = useCallback(async (zoneId: number): Promise<Area[]> => {
    if (areasMap[zoneId]?.length) return areasMap[zoneId];
    if (areasPromiseCache.current[zoneId]) return areasPromiseCache.current[zoneId];

    areasPromiseCache.current[zoneId] = (async () => {
      const { data: cached } = await supabase
        .from("pathao_areas")
        .select("area_id, area_name, zone_id")
        .eq("zone_id", zoneId)
        .order("area_name");

      if (cached?.length) {
        setAreasMap((prev) => ({ ...prev, [zoneId]: cached }));
        return cached;
      }

      const { data } = await supabase.functions.invoke("pathao-courier", { body: { action: "get_areas", zone_id: zoneId } });
      const areas = (data?.data || []).map((area: any) => ({ area_id: area.area_id, area_name: area.area_name, zone_id: area.zone_id ?? zoneId }));
      setAreasMap((prev) => ({ ...prev, [zoneId]: areas }));
      return areas;
    })();

    return areasPromiseCache.current[zoneId];
  }, [areasMap]);

  // Auto-fill: match customer city/zone/area text to Pathao IDs
  useEffect(() => {
    if (!open || orders.length === 0 || cities.length === 0) return;
    // Only auto-fill once per (open + orders set). Without this guard, fetchZones/fetchAreas
    // updating zonesMap/areasMap re-creates these callbacks, re-running this effect and
    // wiping the user's manually-picked city/zone/area selections.
    const key = orders.map((o) => o.id).join(",");
    if (autoFilledKeyRef.current === key) return;
    autoFilledKeyRef.current = key;

    const autoFill = async () => {
      const overrides: typeof orderOverrides = {};

      for (const order of orders) {
        const base = {
          city_id: order.pathao_recipient_city ? String(order.pathao_recipient_city) : "",
          zone_id: order.pathao_recipient_zone ? String(order.pathao_recipient_zone) : "",
          area_id: order.pathao_recipient_area ? String(order.pathao_recipient_area) : "",
          amount_to_collect: String(order.amount_to_collect ?? order.total ?? 0),
          item_weight: String(order.item_weight || 0.5),
          special_instruction: order.special_instruction || "",
          recipient_name: order.customer_name || "",
          recipient_phone: order.customer_phone || "",
          recipient_address: order.customer_address || "",
        };

        const cityCandidates = buildLocationCandidates([order.customer_city, base.recipient_address]);
        const zoneCandidates = buildLocationCandidates([base.recipient_address]);

        // Priority: city first, then zone within city, then area within zone.
        if (!base.city_id) {
          const cityMatch = getStrictLocationMatch(cities, (city) => city.city_name, cityCandidates);
          if (cityMatch) {
            base.city_id = String(cityMatch.city_id);
          }
        }

        // Only fall back to a global zone match if we still have no city —
        // a strict global zone match also tells us its city.
        if (!base.city_id && !base.zone_id && allZones.length > 0) {
          const globalZoneMatch = getStrictLocationMatch(allZones, (zone) => zone.zone_name, zoneCandidates);
          if (globalZoneMatch) {
            base.zone_id = String(globalZoneMatch.zone_id);
            base.city_id = String(globalZoneMatch.city_id);
          }
        }

        const zones = base.city_id ? await fetchZones(Number(base.city_id)) : [];
        if (!base.zone_id && zones.length > 0) {
          const zoneMatch = getStrictLocationMatch(zones, (zone) => zone.zone_name, zoneCandidates);
          if (zoneMatch) {
            base.zone_id = String(zoneMatch.zone_id);
          }
        }

        const areas = base.zone_id ? await fetchAreas(Number(base.zone_id)) : [];
        const areaCandidates = buildLocationCandidates([base.recipient_address]);
        if (!base.area_id && areas.length > 0) {
          const areaMatch = getStrictLocationMatch(areas, (area) => area.area_name, areaCandidates);
          if (areaMatch) {
            base.area_id = String(areaMatch.area_id);
          }
        }

        overrides[order.id] = base;
      }

      setOrderOverrides(overrides);
    };

    void autoFill();
  }, [open, orders, cities, allZones, buildLocationCandidates, fetchAreas, fetchZones, getStrictLocationMatch]);

  const updateOverride = (orderId: string, field: string, value: string) => {
    setOrderOverrides((prev) => ({ ...prev, [orderId]: { ...prev[orderId], [field]: value } }));
  };

  const handleDispatch = async () => {
    if (visibleOrders.length === 0) return;

    // Apply the payment gate to the live batch before any account validation or
    // replace/skip prompt. Gated orders never reach create_bulk.
    const { allowed, skipped } = splitGatedOrders(visibleOrders, "courier");
    if (skipped.length > 0) toast({ title: gateLockedMessage(skipped), variant: "destructive" });
    if (allowed.length === 0) return;
    dispatchableOrderIdsRef.current = new Set(allowed.map((o) => o.id));

    // Each brand/account group dispatches through its own Pathao Account.
    for (const group of groups) {
      if (!group.orderIds.some((id) => allowed.some((o) => o.id === id))) continue;
      if (!accountForGroup(group)) {
        toast({
          title: "Select a Pathao Account",
          description: `Choose a Pathao Account for ${group.brandName}`,
          variant: "destructive",
        });
        return;
      }
    }
    for (const o of allowed) {
      const ov = orderOverrides[o.id];
      if (!ov?.recipient_name || !ov?.recipient_phone || !ov?.recipient_address || !ov?.city_id || !ov?.zone_id) {
        toast({ title: "Missing info", description: `Order #${o.order_number} is missing details`, variant: "destructive" }); return;
      }
    }

    // If any selected order already has a courier entry, show the "This order
    // already has a courier entry" dialog first so the user can choose Replace
    // (cancel previous + dispatch new) or Don't create (skip that order).
    const allowedExistingOrders = ordersWithExisting.filter((o) => dispatchableOrderIdsRef.current?.has(o.id));
    if (allowedExistingOrders.length > 0) {
      setExistingOrders(allowedExistingOrders);
      setReplaceOrderIds(new Set(allowedExistingOrders.map((o) => o.id)));
      return;
    }

    await doDispatch(null);
  };

  const doDispatch = async (replaceFilters: Set<string> | null) => {
    setDispatching(true);
    try {
      const BATCH_SIZE = 20;
      // Orders the user chose NOT to replace (had an existing courier entry and
      // they picked "Don't create") are excluded from the payload entirely.
      const gateAllowedIds = dispatchableOrderIdsRef.current;
      const gateAllowedOrders = gateAllowedIds
        ? visibleOrders.filter((o) => gateAllowedIds.has(o.id))
        : visibleOrders;
      const toDispatch = replaceFilters
        ? gateAllowedOrders.filter((o) => !o.consignment_id || replaceFilters.has(o.id))
        : gateAllowedOrders;

      const allResults: any[] = [];
      // Non-default Pathao Account choices actually used, per group, so each
      // override can be recorded on its orders (timeline + audit log).
      const overrideGroups: Array<{
        group: DispatchBrandGroup;
        account: PathaoAccountOption;
        orderIds: string[];
      }> = [];

      // One create_bulk call per brand/account group (chunked), each booking
      // through its own group's Pathao Account (issue #22).
      for (const group of groups) {
        const groupOrders = toDispatch.filter((o) => group.orderIds.includes(o.id));
        if (groupOrders.length === 0) continue;
        const account = accountForGroup(group);
        if (!account) continue;

        const allPayloads = groupOrders.map((o) => {
          const ov = orderOverrides[o.id];
          const wantingReplace = !!o.consignment_id && replaceFilters?.has(o.id);
          return {
            order_id: o.id,
            ...(wantingReplace ? { replace: true, force: false } : {}),
            order_payload: {
              store_id: account.pathaoStoreId,
              merchant_order_id: o.order_number,
              recipient_name: ov.recipient_name,
              recipient_phone: ov.recipient_phone,
              recipient_address: ov.recipient_address,
              recipient_city: Number(ov.city_id),
              recipient_zone: Number(ov.zone_id),
              recipient_area: ov.area_id ? Number(ov.area_id) : undefined,
              delivery_type: 48, item_type: 2,
              item_quantity: o.itemCount || 1,
              item_weight: Number(ov.item_weight) || 0.5,
              amount_to_collect: Number(ov.amount_to_collect) || 0,
              special_instruction: ov.special_instruction || undefined,
            },
          };
        });

        for (let i = 0; i < allPayloads.length; i += BATCH_SIZE) {
          const batch = allPayloads.slice(i, i + BATCH_SIZE);
          const { data, error } = await supabase.functions.invoke("pathao-courier", {
            body: {
              action: "create_bulk",
              orders: batch,
              integration_id: account.integrationId ?? undefined,
            },
          });
          if (error) throw error;
          const batchResults = data?.data?.results || [];
          allResults.push(...batchResults);
        }

        if (isAccountOverride(accountKeyForGroup(group), group.defaultAccountKey)) {
          overrideGroups.push({ group, account, orderIds: groupOrders.map((o) => o.id) });
        }
      }

      const results = allResults;
      const succeeded = results.filter((r: any) => r.success).length;
      const failed = results.filter((r: any) => !r.success);

      // Record every non-default Pathao Account actually used, on each order
      // it dispatched (issue #22).
      const dispatchedIds = new Set(
        results.filter((r: any) => r.success && r.order_id).map((r: any) => r.order_id as string),
      );
      for (const overrideGroup of overrideGroups) {
        const okIds = dispatchedIds.size > 0
          ? overrideGroup.orderIds.filter((id) => dispatchedIds.has(id))
          : overrideGroup.orderIds;
        if (okIds.length === 0) continue;
        await recordPathaoAccountOverride({
          orderIds: okIds,
          orderNumbers: Object.fromEntries(
            okIds.map((id) => [id, visibleOrders.find((o) => o.id === id)?.order_number ?? ""]),
          ),
          brandName: overrideGroup.group.brandName,
          defaultAccount: overrideGroup.group.defaultAccount,
          selectedAccount: overrideGroup.account,
        });
      }

      if (failed.length > 0) {
        toast({ title: `${succeeded} dispatched, ${failed.length} failed`, description: failed.map((f: any) => f.error).join("; ").slice(0, 200), variant: failed.length === results.length ? "destructive" : "default" });
      } else {
        toast({ title: `${succeeded} order(s) dispatched to Pathao!` });
      }
      setExistingOrders([]);
      onOpenChange(false);
      onDispatched();
    } catch (err: any) {
      toast({ title: "Dispatch failed", description: err.message, variant: "destructive" });
    } finally {
      setDispatching(false);
    }
  };

  const selectedService = courierServices.find((s) => s.id === selectedServiceId) ?? null;
  const serviceSupportsDispatch = selectedService
    ? (courierProviderInfo(selectedService.provider)?.dispatchSupported ?? false)
    : false;

  return (
    <>
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Dispatch to Pathao (${visibleOrders.length} order${visibleOrders.length === 1 ? "" : "s"})`}
      desktopMaxWidth="max-w-3xl"
      footer={
        <div className="w-full space-y-3">
          {/* Branded identity selector per brand/account group, directly above
              the action buttons; replaces the old Pathao Store dropdown
              (issue #22). */}
          {groups.map((group) => {
            const accountKey = accountKeyForGroup(group);
            const account = accountForGroup(group);
            const overridden = isAccountOverride(accountKey, group.defaultAccountKey);
            const warningKey = `${group.key}|${accountKey}`;
            return (
              <IdentityStripCard key={group.key}>
                <div className="flex flex-wrap items-stretch gap-2">
                  {/* Brand — logo-or-monogram + name (this group's order identity) */}
                  <IdentitySegment
                    label="Brand"
                    value={group.brandName}
                    icon={
                      <BrandAvatar
                        brandId={group.brandId}
                        brandName={group.brandName}
                        logoUrl={group.brandLogoUrl}
                      />
                    }
                  />
                  {/* Order Source(s) covered by this group */}
                  <IdentitySegment
                    label="Order Source"
                    value={group.orderSourceNames.join(", ") || "—"}
                    subValue={`${group.orderIds.length} order${group.orderIds.length === 1 ? "" : "s"}`}
                  />
                  {/* Pathao Account — account name + pickup store, click to change */}
                  {accountOptions.length === 0 ? (
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
                          value={account?.accountName ?? "Choose Pathao Account"}
                          subValue={
                            account
                              ? `Pickup: ${account.pickupStoreName}`
                              : group.defaultAccount
                                ? `Default: ${group.defaultAccount.accountName}`
                                : undefined
                          }
                          icon={<PathaoMark />}
                          onClick={() => {}}
                        />
                      </PopoverTrigger>
                      <PopoverContent align="start" side="top" className="w-[300px] p-1">
                        {accountOptions.map((option) => (
                          <button
                            key={option.key}
                            type="button"
                            onClick={() => {
                              setGroupAccountKeys((prev) => ({ ...prev, [group.key]: option.key }));
                              // A new choice re-arms the override warning.
                              setOverrideDismissed((prev) =>
                                new Set(Array.from(prev).filter((key) => !key.startsWith(`${group.key}|`))),
                              );
                            }}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
                          >
                            <PathaoMark className="h-6 w-6" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{option.accountName}</span>
                              <span className="block truncate text-[10px] text-muted-foreground">
                                Pickup: {option.pickupStoreName}
                              </span>
                            </span>
                            {option.key === group.defaultAccountKey && (
                              <Badge variant="outline" className="text-[9px]">Default</Badge>
                            )}
                            {option.key === accountKey && <Check className="h-3.5 w-3.5 shrink-0" />}
                          </button>
                        ))}
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
                {/* Per-order chips with batch-only X / remove (issue #22) */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {group.orderIds.map((orderId) => {
                    const order = visibleOrders.find((o) => o.id === orderId);
                    if (!order) return null;
                    return (
                      <BatchOrderChip
                        key={orderId}
                        label={`#${order.order_number}`}
                        onRemove={() => handleRemoveOrder(orderId)}
                        removeTitle={`Remove order #${order.order_number} from this batch`}
                      />
                    );
                  })}
                </div>
                {overridden && account && !overrideDismissed.has(warningKey) && (
                  <StripWarning
                    message={`This group will dispatch through a non-default Pathao Account (${account.accountName} · ${account.pickupStoreName}).`}
                    onDismiss={() =>
                      setOverrideDismissed((prev) => new Set(prev).add(warningKey))
                    }
                  />
                )}
              </IdentityStripCard>
            );
          })}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleDispatch} disabled={dispatching || visibleOrders.length === 0 || !serviceSupportsDispatch} className="gap-2">
              {dispatching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Dispatch {visibleOrders.length} Order(s)
            </Button>
          </div>
        </div>
      }
    >
        {/* Business-level courier service (spec §4) */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 pb-2">
          <Label className="text-sm font-medium whitespace-nowrap">Courier service:</Label>
          <Select value={selectedServiceId} onValueChange={setSelectedServiceId}>
            <SelectTrigger className="w-full sm:w-[320px]">
              <SelectValue placeholder={courierServices.length > 0 ? "Select courier service" : "No courier services yet"} />
            </SelectTrigger>
            <SelectContent>
              {courierServices.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} · {courierProviderLabel(s.provider)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedService && !serviceSupportsDispatch && (
            <p className="text-xs text-muted-foreground">
              {courierProviderLabel(selectedService.provider)} dispatch arrives with its adapter —
              pick a Pathao service to dispatch now.
            </p>
          )}
          {courierServices.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Add the business's courier account under Settings → Courier services.
            </p>
          )}
        </div>

        <div className="space-y-6">
          {visibleOrders.length === 0 && (
            <p className="text-sm text-muted-foreground">No orders in this batch.</p>
          )}
          {visibleOrders.map((order) => {
            const ov = orderOverrides[order.id] || { city_id: "", zone_id: "", area_id: "", amount_to_collect: "", item_weight: "", special_instruction: "", recipient_name: "", recipient_phone: "", recipient_address: "" };
            const cityId = ov.city_id ? Number(ov.city_id) : 0;
            const zoneId = ov.zone_id ? Number(ov.zone_id) : 0;
            const zones = zonesMap[cityId] || [];
            const areas = areasMap[zoneId] || [];

            return (
              <div key={order.id} className="rounded-lg border border-border p-3 sm:p-4 space-y-3 sm:space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-foreground">#{order.order_number}</span>
                    <span className="ml-2 text-sm text-muted-foreground">— {symbol}{Number(order.total).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{order.itemCount} item(s)</Badge>
                    {/* Per-order X / remove — batch only, no confirmation (issue #22) */}
                    <button
                      type="button"
                      onClick={() => handleRemoveOrder(order.id)}
                      title={`Remove order #${order.order_number} from this batch`}
                      aria-label={`Remove order #${order.order_number} from this batch`}
                      className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Recipient Name</Label>
                    <Input value={ov.recipient_name} onChange={(e) => updateOverride(order.id, "recipient_name", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Phone</Label>
                    <Input inputMode="tel" value={ov.recipient_phone} onChange={(e) => updateOverride(order.id, "recipient_phone", e.target.value)} placeholder="01XXXXXXXXX" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Address</Label>
                  <Input value={ov.recipient_address} onChange={(e) => updateOverride(order.id, "recipient_address", e.target.value)} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">City</Label>
                    <SearchableSelect
                      options={cities.map((c) => ({ value: String(c.city_id), label: c.city_name }))}
                      value={ov.city_id}
                      onChange={(val) => {
                        updateOverride(order.id, "city_id", val);
                        updateOverride(order.id, "zone_id", "");
                        updateOverride(order.id, "area_id", "");
                        if (val) fetchZones(Number(val));
                      }}
                      placeholder="City"
                      searchPlaceholder="Search cities..."
                      emptyText="No city found"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Zone</Label>
                    <SearchableSelect
                      options={zones.map((z) => ({ value: String(z.zone_id), label: z.zone_name }))}
                      value={ov.zone_id}
                      onChange={(val) => {
                        updateOverride(order.id, "zone_id", val);
                        updateOverride(order.id, "area_id", "");
                        if (val) fetchAreas(Number(val));
                      }}
                      placeholder="Zone"
                      searchPlaceholder="Search zones..."
                      emptyText="No zone found"
                      disabled={!ov.city_id}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Area</Label>
                    <SearchableSelect
                      options={areas.map((a) => ({ value: String(a.area_id), label: a.area_name }))}
                      value={ov.area_id}
                      onChange={(val) => updateOverride(order.id, "area_id", val)}
                      placeholder="Area"
                      searchPlaceholder="Search areas..."
                      emptyText="No area found"
                      disabled={!ov.zone_id}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">COD Amount</Label>
                    <Input type="number" inputMode="numeric" value={ov.amount_to_collect} onChange={(e) => updateOverride(order.id, "amount_to_collect", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Weight (kg)</Label>
                    <Input type="number" inputMode="decimal" step="0.1" value={ov.item_weight} onChange={(e) => updateOverride(order.id, "item_weight", e.target.value)} />
                  </div>
                  <div className="space-y-1.5 col-span-2 sm:col-span-1">
                    <Label className="text-xs">Special Instruction</Label>
                    <Input value={ov.special_instruction} onChange={(e) => updateOverride(order.id, "special_instruction", e.target.value)} placeholder="Optional" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
    </ResponsiveDialog>

      {/* "This order already has a courier entry" — Replace or Don't create */}
      <AlertDialog
        open={existingConfirmOpen}
        onOpenChange={(open) => !open && setExistingOrders([])}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <div className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
              <AlertDialogTitle>This order already has a consignment</AlertDialogTitle>
            </div>
            <AlertDialogDescription className="space-y-2 pt-2">
              <p className="text-sm text-muted-foreground">
                {existingOrders.length === 1
                  ? `Order #${existingOrders[0].order_number} already has courier consignment ${existingOrders[0].consignment_id}.`
                  : `${existingOrders.length} of the selected orders already have a consignment.`}
              </p>
              <p className="text-xs text-muted-foreground">
                Choose <strong className="text-foreground">Replace</strong> to cancel the previous consignment on Pathao and dispatch a new one, or{" "}
                <strong className="text-foreground">Don't create</strong> to skip that order.
              </p>
              <div className="rounded-lg border border-border bg-background/30 p-2 space-y-2 mt-1 max-h-52 overflow-y-auto">
                {existingOrders.map((o) => {
                  const checked = replaceOrderIds.has(o.id);
                  return (
                    <label
                      key={o.id}
                      className="flex items-start gap-2.5 cursor-pointer rounded-md p-1.5 hover:bg-muted"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const next = new Set(replaceOrderIds);
                          if (next.has(o.id)) next.delete(o.id);
                          else next.add(o.id);
                          setReplaceOrderIds(next);
                        }}
                        className="mt-1"
                      />
                      <span className="text-xs text-foreground">
                        #{o.order_number}
                        <span className="text-muted-foreground"> — {o.consignment_id}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {checked ? "Replace (cancel previous + dispatch new)" : "Don't create (skip this order)"}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setExistingOrders([])} disabled={dispatching}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={dispatching || replaceOrderIds.size === 0}
              onClick={() => doDispatch(replaceOrderIds)}
              className="bg-amber-600 hover:bg-amber-500 text-amber-50"
            >
              {dispatching ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              {replaceOrderIds.size > 0 && skipCount > 0
                ? `Replace ${replaceOrderIds.size} & skip ${skipCount}`
                : replaceOrderIds.size > 0
                ? `Replace ${replaceOrderIds.size} & Dispatch`
                : "Dispatch"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
