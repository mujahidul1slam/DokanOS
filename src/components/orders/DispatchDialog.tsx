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
  customers: { name: string; phone: string | null; address: string | null } | null;
  pathao_recipient_city: number | null;
  pathao_recipient_zone: number | null;
  pathao_recipient_area: number | null;
  amount_to_collect: number | null;
  item_weight: number | null;
  special_instruction: string | null;
}

interface City { city_id: number; city_name: string }
interface Zone { zone_id: number; zone_name: string }
interface Area { area_id: number; area_name: string }
interface PathaoStore { pathao_store_id: number; store_name: string }

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
      const [{ data: stores }, { data: citiesData }] = await Promise.all([
        supabase.from("pathao_stores").select("pathao_store_id, store_name").eq("is_active", true),
        supabase.from("pathao_cities").select("city_id, city_name").order("city_name"),
      ]);
      setPathaoStores(stores || []);
      setCities(citiesData || []);
      if (stores?.length && !selectedPathaoStore) {
        setSelectedPathaoStore(String(stores[0].pathao_store_id));
      }
    })();
  }, [open]);

  useEffect(() => {
    if (!open || orders.length === 0) return;
    const overrides: typeof orderOverrides = {};
    for (const o of orders) {
      overrides[o.id] = {
        city_id: o.pathao_recipient_city ? String(o.pathao_recipient_city) : "",
        zone_id: o.pathao_recipient_zone ? String(o.pathao_recipient_zone) : "",
        area_id: o.pathao_recipient_area ? String(o.pathao_recipient_area) : "",
        amount_to_collect: String(o.amount_to_collect || o.total || 0),
        item_weight: String(o.item_weight || 0.5),
        special_instruction: o.special_instruction || "",
        recipient_name: o.customers?.name || "",
        recipient_phone: o.customers?.phone || "",
        recipient_address: o.customers?.address || "",
      };
    }
    setOrderOverrides(overrides);
  }, [open, orders]);

  const fetchZones = async (cityId: number) => {
    if (zonesMap[cityId]) return;
    const { data: cached } = await supabase.from("pathao_zones").select("zone_id, zone_name").eq("city_id", cityId).order("zone_name");
    if (cached?.length) { setZonesMap((p) => ({ ...p, [cityId]: cached })); return; }
    const { data } = await supabase.functions.invoke("pathao-courier", { body: { action: "get_zones", city_id: cityId } });
    setZonesMap((p) => ({ ...p, [cityId]: (data?.data || []).map((z: any) => ({ zone_id: z.zone_id, zone_name: z.zone_name })) }));
  };

  const fetchAreas = async (zoneId: number) => {
    if (areasMap[zoneId]) return;
    const { data: cached } = await supabase.from("pathao_areas").select("area_id, area_name").eq("zone_id", zoneId).order("area_name");
    if (cached?.length) { setAreasMap((p) => ({ ...p, [zoneId]: cached })); return; }
    const { data } = await supabase.functions.invoke("pathao-courier", { body: { action: "get_areas", zone_id: zoneId } });
    setAreasMap((p) => ({ ...p, [zoneId]: (data?.data || []).map((a: any) => ({ area_id: a.area_id, area_name: a.area_name })) }));
  };

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
      const bulkPayload = orders.map((o) => {
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
      const { data, error } = await supabase.functions.invoke("pathao-courier", { body: { action: "create_bulk", orders: bulkPayload } });
      if (error) throw error;
      const results = data?.data?.results || [];
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
