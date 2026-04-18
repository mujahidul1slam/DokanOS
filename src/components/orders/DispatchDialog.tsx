import { useState, useEffect, useCallback } from "react";
import { Send, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface DispatchOrder {
  id: string;
  order_number: string;
  total: number;
  itemCount: number;
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
}

interface City { city_id: number; city_name: string }
interface Zone { zone_id: number; zone_name: string; city_id: number }
interface Area { area_id: number; area_name: string }
interface PathaoStore { pathao_store_id: number; store_name: string; integration_id: string | null }

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
  ["narshingdi", "narsingdi", "narshingdi"],
  ["gopalgonj", "gopalganj"],
];

interface DispatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orders: DispatchOrder[];
  onDispatched: () => void;
}

export default function DispatchDialog({ open, onOpenChange, orders, onDispatched }: DispatchDialogProps) {
  const [dispatching, setDispatching] = useState(false);
  const [pathaoStores, setPathaoStores] = useState<PathaoStore[]>([]);
  const [selectedPathaoStore, setSelectedPathaoStore] = useState("");
  const [cities, setCities] = useState<City[]>([]);
  const [allZones, setAllZones] = useState<Zone[]>([]);
  const [zonesMap, setZonesMap] = useState<Record<number, Zone[]>>({});
  const [areasMap, setAreasMap] = useState<Record<number, Area[]>>({});
  const [orderOverrides, setOrderOverrides] = useState<Record<string, {
    city_id: string; zone_id: string; area_id: string;
    amount_to_collect: string; item_weight: string; special_instruction: string;
    recipient_name: string; recipient_phone: string; recipient_address: string;
  }>>({});
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    (async () => {
      const [{ data: stores }, { data: citiesData }, { data: zonesData }] = await Promise.all([
        supabase.from("pathao_stores").select("pathao_store_id, store_name, integration_id").eq("is_active", true),
        supabase.from("pathao_cities").select("city_id, city_name").order("city_name"),
        supabase.from("pathao_zones").select("zone_id, zone_name, city_id").order("zone_name"),
      ]);
      setPathaoStores((stores || []) as PathaoStore[]);
      setCities(citiesData || []);
      setAllZones(zonesData || []);
      if (stores?.length && !selectedPathaoStore) {
        setSelectedPathaoStore(String(stores[0].pathao_store_id));
      }
    })();
  }, [open]);

  const normalizeLocationText = useCallback((value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, ""), []);

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
      if (group.includes(normalized)) {
        group.forEach((alias) => variants.add(alias));
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

  const fuzzyMatch = useCallback(<T,>(items: T[], getText: (item: T) => string, queries: string | string[]): T | undefined => {
    const queryList = Array.isArray(queries) ? queries : [queries];

    for (const rawQuery of queryList) {
      const q = normalizeLocationText(rawQuery);
      if (!q) continue;

      let best = items.find((item) => normalizeLocationText(getText(item)) === q);
      if (best) return best;

      best = items.find((item) => {
        const value = normalizeLocationText(getText(item));
        return value.startsWith(q) || q.startsWith(value);
      });
      if (best) return best;

      best = items.find((item) => {
        const value = normalizeLocationText(getText(item));
        return value.includes(q) || q.includes(value);
      });
      if (best) return best;

      let minDistance = Infinity;
      let closest: T | undefined;

      for (const item of items) {
        const currentDistance = getEditDistance(q, normalizeLocationText(getText(item)));
        const threshold = Math.max(2, Math.floor(q.length * 0.35));
        if (currentDistance < minDistance && currentDistance <= threshold) {
          minDistance = currentDistance;
          closest = item;
        }
      }

      if (closest) return closest;
    }

    return undefined;
  }, [getEditDistance, normalizeLocationText]);

  const fetchZones = useCallback(async (cityId: number): Promise<Zone[]> => {
    if (zonesMap[cityId]?.length) return zonesMap[cityId];

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
  }, [zonesMap]);

  const fetchAreas = useCallback(async (zoneId: number): Promise<Area[]> => {
    if (areasMap[zoneId]?.length) return areasMap[zoneId];

    const { data: cached } = await supabase
      .from("pathao_areas")
      .select("area_id, area_name")
      .eq("zone_id", zoneId)
      .order("area_name");

    if (cached?.length) {
      setAreasMap((prev) => ({ ...prev, [zoneId]: cached }));
      return cached;
    }

    const { data } = await supabase.functions.invoke("pathao-courier", { body: { action: "get_areas", zone_id: zoneId } });
    const areas = (data?.data || []).map((area: any) => ({ area_id: area.area_id, area_name: area.area_name }));
    setAreasMap((prev) => ({ ...prev, [zoneId]: areas }));
    return areas;
  }, [areasMap]);

  // Auto-fill: match customer city/zone/area text to Pathao IDs
  useEffect(() => {
    if (!open || orders.length === 0 || cities.length === 0) return;

    const autoFill = async () => {
      const overrides: typeof orderOverrides = {};

      for (const order of orders) {
        const base = {
          city_id: order.pathao_recipient_city ? String(order.pathao_recipient_city) : "",
          zone_id: order.pathao_recipient_zone ? String(order.pathao_recipient_zone) : "",
          area_id: order.pathao_recipient_area ? String(order.pathao_recipient_area) : "",
          amount_to_collect: String(order.amount_to_collect || order.total || 0),
          item_weight: String(order.item_weight || 0.5),
          special_instruction: order.special_instruction || "",
          recipient_name: order.customer_name || "",
          recipient_phone: order.customer_phone || "",
          recipient_address: order.customer_address || "",
        };

        const cityCandidates = buildLocationCandidates([order.customer_city, base.recipient_address]);
        const zoneCandidates = buildLocationCandidates([base.recipient_address]);

        if (!base.zone_id && allZones.length > 0) {
          const globalZoneMatch = getStrictLocationMatch(allZones, (zone) => zone.zone_name, zoneCandidates);
          if (globalZoneMatch) {
            base.zone_id = String(globalZoneMatch.zone_id);
            base.city_id = String(globalZoneMatch.city_id);
          }
        }

        if (!base.city_id) {
          // For city, only accept exact/alias matches from address words (no fuzzy on short tokens)
          const cityMatch = getStrictLocationMatch(cities, (city) => city.city_name, cityCandidates);
          if (cityMatch) {
            base.city_id = String(cityMatch.city_id);
          }
        }

        const zones = base.city_id ? await fetchZones(Number(base.city_id)) : [];
        if (!base.zone_id && zones.length > 0) {
          const zoneMatch = fuzzyMatch(zones, (zone) => zone.zone_name, zoneCandidates);
          if (zoneMatch) {
            base.zone_id = String(zoneMatch.zone_id);
          }
        }

        const areas = base.zone_id ? await fetchAreas(Number(base.zone_id)) : [];
        const areaCandidates = buildLocationCandidates([base.recipient_address]);
        if (!base.area_id && areas.length > 0) {
          const areaMatch = fuzzyMatch(areas, (area) => area.area_name, areaCandidates);
          if (areaMatch) {
            base.area_id = String(areaMatch.area_id);
          }
        }

        overrides[order.id] = base;
      }

      setOrderOverrides(overrides);
    };

    void autoFill();
  }, [open, orders, cities, allZones, buildLocationCandidates, fetchAreas, fetchZones, fuzzyMatch, getStrictLocationMatch]);

  const updateOverride = (orderId: string, field: string, value: string) => {
    setOrderOverrides((prev) => ({ ...prev, [orderId]: { ...prev[orderId], [field]: value } }));
  };

  const handleDispatch = async () => {
    if (!selectedPathaoStore) { toast({ title: "Select a Pathao store first", variant: "destructive" }); return; }
    for (const o of orders) {
      const ov = orderOverrides[o.id];
      if (!ov?.recipient_name || !ov?.recipient_phone || !ov?.recipient_address || !ov?.city_id || !ov?.zone_id) {
        toast({ title: "Missing info", description: `Order #${o.order_number} is missing details`, variant: "destructive" }); return;
      }
    }
    setDispatching(true);
    try {
      const BATCH_SIZE = 20;
      const allPayloads = orders.map((o) => {
        const ov = orderOverrides[o.id];
        return {
          order_id: o.id,
          order_payload: {
            store_id: Number(selectedPathaoStore),
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
      const selectedStore = pathaoStores.find((s) => String(s.pathao_store_id) === selectedPathaoStore);
      const integrationId = selectedStore?.integration_id || undefined;
      const allResults: any[] = [];
      for (let i = 0; i < allPayloads.length; i += BATCH_SIZE) {
        const batch = allPayloads.slice(i, i + BATCH_SIZE);
        const { data, error } = await supabase.functions.invoke("pathao-courier", { body: { action: "create_bulk", orders: batch, integration_id: integrationId } });
        if (error) throw error;
        const batchResults = data?.data?.results || [];
        allResults.push(...batchResults);
      }
      const results = allResults;
      const succeeded = results.filter((r: any) => r.success).length;
      const failed = results.filter((r: any) => !r.success);
      if (failed.length > 0) {
        toast({ title: `${succeeded} dispatched, ${failed.length} failed`, description: failed.map((f: any) => f.error).join("; ").slice(0, 200), variant: failed.length === results.length ? "destructive" : "default" });
      } else {
        toast({ title: `${succeeded} order(s) dispatched to Pathao!` });
      }
      onOpenChange(false);
      onDispatched();
    } catch (err: any) {
      toast({ title: "Dispatch failed", description: err.message, variant: "destructive" });
    } finally {
      setDispatching(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Dispatch to Pathao ({orders.length} order{orders.length > 1 ? "s" : ""})</DialogTitle>
          <DialogDescription>Review and confirm recipient details before dispatching.</DialogDescription>
        </DialogHeader>

        {/* Pathao store selector */}
        <div className="flex items-center gap-3 pb-2">
          <Label className="text-sm font-medium whitespace-nowrap">Pathao Store:</Label>
          <Select value={selectedPathaoStore} onValueChange={setSelectedPathaoStore}>
            <SelectTrigger className="w-[260px]"><SelectValue placeholder="Select Pathao store" /></SelectTrigger>
            <SelectContent>
              {pathaoStores.map((s) => (
                <SelectItem key={s.pathao_store_id} value={String(s.pathao_store_id)}>{s.store_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-6">
          {orders.map((order) => {
            const ov = orderOverrides[order.id] || { city_id: "", zone_id: "", area_id: "", amount_to_collect: "", item_weight: "", special_instruction: "", recipient_name: "", recipient_phone: "", recipient_address: "" };
            const cityId = ov.city_id ? Number(ov.city_id) : 0;
            const zoneId = ov.zone_id ? Number(ov.zone_id) : 0;
            const zones = zonesMap[cityId] || [];
            const areas = areasMap[zoneId] || [];

            return (
              <div key={order.id} className="rounded-lg border border-border p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-foreground">#{order.order_number}</span>
                    <span className="ml-2 text-sm text-muted-foreground">— ৳{Number(order.total).toLocaleString()}</span>
                  </div>
                  <Badge variant="outline">{order.itemCount} item(s)</Badge>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Recipient Name</Label>
                    <Input value={ov.recipient_name} onChange={(e) => updateOverride(order.id, "recipient_name", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Phone</Label>
                    <Input value={ov.recipient_phone} onChange={(e) => updateOverride(order.id, "recipient_phone", e.target.value)} placeholder="01XXXXXXXXX" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Address</Label>
                  <Input value={ov.recipient_address} onChange={(e) => updateOverride(order.id, "recipient_address", e.target.value)} />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">City</Label>
                    <Select value={ov.city_id} onValueChange={(val) => { updateOverride(order.id, "city_id", val); updateOverride(order.id, "zone_id", ""); updateOverride(order.id, "area_id", ""); fetchZones(Number(val)); }}>
                      <SelectTrigger><SelectValue placeholder="City" /></SelectTrigger>
                      <SelectContent>{cities.map((c) => <SelectItem key={c.city_id} value={String(c.city_id)}>{c.city_name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Zone</Label>
                    <Select value={ov.zone_id} onValueChange={(val) => { updateOverride(order.id, "zone_id", val); updateOverride(order.id, "area_id", ""); fetchAreas(Number(val)); }} disabled={!ov.city_id}>
                      <SelectTrigger><SelectValue placeholder="Zone" /></SelectTrigger>
                      <SelectContent>{zones.map((z) => <SelectItem key={z.zone_id} value={String(z.zone_id)}>{z.zone_name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Area</Label>
                    <Select value={ov.area_id} onValueChange={(val) => updateOverride(order.id, "area_id", val)} disabled={!ov.zone_id}>
                      <SelectTrigger><SelectValue placeholder="Area" /></SelectTrigger>
                      <SelectContent>{areas.map((a) => <SelectItem key={a.area_id} value={String(a.area_id)}>{a.area_name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">COD Amount</Label>
                    <Input type="number" value={ov.amount_to_collect} onChange={(e) => updateOverride(order.id, "amount_to_collect", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Weight (kg)</Label>
                    <Input type="number" step="0.1" value={ov.item_weight} onChange={(e) => updateOverride(order.id, "item_weight", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Special Instruction</Label>
                    <Input value={ov.special_instruction} onChange={(e) => updateOverride(order.id, "special_instruction", e.target.value)} placeholder="Optional" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleDispatch} disabled={dispatching} className="gap-2">
            {dispatching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Dispatch {orders.length} Order(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
