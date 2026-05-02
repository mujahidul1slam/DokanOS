import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { useToast } from "@/hooks/use-toast";
import { addOrderTimeline } from "@/lib/orderTimeline";
import { logAction } from "@/lib/auditLog";

/**
 * ExchangeDialog
 * --------------
 * Pathao's public Aladdin v1 API does NOT expose a dedicated "exchange parcel"
 * endpoint — exchange parcels are normally created from the Pathao merchant
 * panel against a delivered consignment. The standard programmatic workaround
 * (also used by Pathao's own WooCommerce plugin) is to create a brand-new
 * order via /aladdin/api/v1/orders with:
 *   - merchant_order_id prefixed with "EXCH-<original_order_number>"
 *   - special_instruction prefixed with "EXCHANGE | Pickup: ... | Deliver: ..."
 *   - amount_to_collect set to the price difference (positive = customer pays
 *     more, 0 = even swap; negative refunds are handled out-of-band).
 *
 * This dialog wraps that flow:
 *   1. Loads the parent order (delivered/completed).
 *   2. Pre-fills recipient address + Pathao city/zone/area from the parent.
 *   3. Lets staff describe the pickup item + the new item being delivered.
 *   4. Provides quick-fill buttons for the COD amount (0, inside-Dhaka shipping,
 *      outside-Dhaka shipping, or fully manual).
 *   5. Creates a child orders row (source='exchange', is_exchange=true,
 *      parent_order_id=<original>), then invokes pathao-courier `create_order`.
 *   6. Writes timeline + audit entries on both parent and child.
 */

interface City { city_id: number; city_name: string }
interface Zone { zone_id: number; zone_name: string; city_id: number }
interface Area { area_id: number; area_name: string; zone_id: number }
interface PathaoStore {
  pathao_store_id: number;
  store_name: string;
  integration_id: string | null;
}

interface ParentOrder {
  id: string;
  order_number: string;
  store_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  customer_city: string | null;
  customer_email: string | null;
  pathao_recipient_city: number | null;
  pathao_recipient_zone: number | null;
  pathao_recipient_area: number | null;
  pathao_store_id: number | null;
  pathao_integration_id: string | null;
  status: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-loaded parent order — used by the OrderDetailSheet flow. */
  parentOrder?: ParentOrder | null;
  /** Picker mode — used by the standalone "New Exchange" button on Orders page. */
  pickerMode?: boolean;
  onCreated?: (newOrderId: string, consignmentId: string | null) => void;
}

export default function ExchangeDialog({
  open, onOpenChange, parentOrder: parentProp, pickerMode = false, onCreated,
}: Props) {
  const { toast } = useToast();

  const [parent, setParent] = useState<ParentOrder | null>(parentProp ?? null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerResults, setPickerResults] = useState<ParentOrder[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  const [pathaoStores, setPathaoStores] = useState<PathaoStore[]>([]);
  const [selectedPathaoStore, setSelectedPathaoStore] = useState<string>("");

  const [cities, setCities] = useState<City[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);

  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [cityId, setCityId] = useState<string>("");
  const [zoneId, setZoneId] = useState<string>("");
  const [areaId, setAreaId] = useState<string>("");

  const [pickupDescription, setPickupDescription] = useState("");
  const [deliverDescription, setDeliverDescription] = useState("");
  const [itemWeight, setItemWeight] = useState("0.5");
  const [amountToCollect, setAmountToCollect] = useState("0");
  const [extraInstruction, setExtraInstruction] = useState("");

  const [shippingInside, setShippingInside] = useState<number>(80);
  const [shippingOutside, setShippingOutside] = useState<number>(150);

  const [submitting, setSubmitting] = useState(false);

  /* ─── Reset on close ─── */
  useEffect(() => {
    if (!open) {
      setParent(parentProp ?? null);
      setPickerQuery(""); setPickerResults([]);
      setRecipientName(""); setRecipientPhone(""); setRecipientAddress("");
      setCityId(""); setZoneId(""); setAreaId("");
      setPickupDescription(""); setDeliverDescription("");
      setItemWeight("0.5"); setAmountToCollect("0"); setExtraInstruction("");
    } else {
      setParent(parentProp ?? null);
    }
  }, [open, parentProp]);

  /* ─── Load Pathao stores + cities + invoice shipping presets ─── */
  useEffect(() => {
    if (!open) return;
    (async () => {
      const [{ data: stores }, { data: citiesData }, { data: inv }] = await Promise.all([
        supabase
          .from("pathao_stores")
          .select("pathao_store_id, store_name, integration_id")
          .eq("is_active", true),
        supabase.from("pathao_cities").select("city_id, city_name").order("city_name"),
        supabase
          .from("invoice_settings")
          .select("shipping_inside_dhaka, shipping_outside_dhaka")
          .limit(1)
          .maybeSingle(),
      ]);
      setPathaoStores((stores || []) as PathaoStore[]);
      setCities((citiesData || []) as City[]);
      if (inv) {
        setShippingInside(Number(inv.shipping_inside_dhaka) || 80);
        setShippingOutside(Number(inv.shipping_outside_dhaka) || 150);
      }
      if (stores?.length && !selectedPathaoStore) {
        setSelectedPathaoStore(String(stores[0].pathao_store_id));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /* ─── Pre-fill from parent order ─── */
  useEffect(() => {
    if (!parent) return;
    setRecipientName(parent.customer_name || "");
    setRecipientPhone(parent.customer_phone || "");
    setRecipientAddress(parent.customer_address || "");
    if (parent.pathao_recipient_city) setCityId(String(parent.pathao_recipient_city));
    if (parent.pathao_recipient_zone) setZoneId(String(parent.pathao_recipient_zone));
    if (parent.pathao_recipient_area) setAreaId(String(parent.pathao_recipient_area));
    if (parent.pathao_store_id) setSelectedPathaoStore(String(parent.pathao_store_id));
  }, [parent]);

  /* ─── Load zones when city changes ─── */
  useEffect(() => {
    if (!cityId) { setZones([]); return; }
    (async () => {
      const { data } = await supabase
        .from("pathao_zones")
        .select("zone_id, zone_name, city_id")
        .eq("city_id", Number(cityId))
        .order("zone_name");
      setZones((data || []) as Zone[]);
    })();
  }, [cityId]);

  /* ─── Load areas when zone changes ─── */
  useEffect(() => {
    if (!zoneId) { setAreas([]); return; }
    (async () => {
      const { data } = await supabase
        .from("pathao_areas")
        .select("area_id, area_name, zone_id")
        .eq("zone_id", Number(zoneId))
        .order("area_name");
      setAreas((data || []) as Area[]);
    })();
  }, [zoneId]);

  /* ─── Picker search (standalone mode) ─── */
  useEffect(() => {
    if (!pickerMode || !open) return;
    const q = pickerQuery.trim();
    if (q.length < 2) { setPickerResults([]); return; }
    const t = setTimeout(async () => {
      setPickerLoading(true);
      const { data } = await supabase
        .from("orders")
        .select(
          "id, order_number, store_id, customer_id, customer_name, customer_phone, customer_address, customer_city, customer_email, pathao_recipient_city, pathao_recipient_zone, pathao_recipient_area, pathao_store_id, pathao_integration_id, status"
        )
        .or(`order_number.ilike.%${q}%,customer_name.ilike.%${q}%,customer_phone.ilike.%${q}%`)
        .in("status", ["delivered", "completed"])
        .order("created_at", { ascending: false })
        .limit(10);
      setPickerResults((data || []) as ParentOrder[]);
      setPickerLoading(false);
    }, 250);
    return () => clearTimeout(t);
  }, [pickerQuery, pickerMode, open]);

  /* ─── Helpers ─── */
  const cityOptions = useMemo(
    () => cities.map((c) => ({ value: String(c.city_id), label: c.city_name })),
    [cities]
  );
  const zoneOptions = useMemo(
    () => zones.map((z) => ({ value: String(z.zone_id), label: z.zone_name })),
    [zones]
  );
  const areaOptions = useMemo(
    () => areas.map((a) => ({ value: String(a.area_id), label: a.area_name })),
    [areas]
  );

  /* ─── Submit ─── */
  const canSubmit =
    !!parent && !!selectedPathaoStore && !!recipientName && !!recipientPhone &&
    !!recipientAddress && !!cityId && !!zoneId &&
    (pickupDescription.trim() || deliverDescription.trim());

  const handleSubmit = async () => {
    if (!parent) {
      toast({ title: "Pick a parent order first", variant: "destructive" });
      return;
    }
    if (!canSubmit) {
      toast({ title: "Missing info", description: "Recipient, location, and exchange items are required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      // 1. Generate an order number for the new exchange order.
      const { data: numData, error: numErr } = await supabase.rpc(
        "generate_pos_order_number",
        { p_store_id: parent.store_id, p_source: "manual" }
      );
      if (numErr) throw numErr;
      const exchangeOrderNumber = `EXCH-${parent.order_number}-${String(numData || "").slice(-4) || Date.now().toString().slice(-4)}`;

      const cod = Math.max(0, Number(amountToCollect) || 0);
      const specialInstructionParts = ["EXCHANGE PARCEL"];
      if (pickupDescription.trim()) specialInstructionParts.push(`Pickup: ${pickupDescription.trim()}`);
      if (deliverDescription.trim()) specialInstructionParts.push(`Deliver: ${deliverDescription.trim()}`);
      specialInstructionParts.push(`Original Order: ${parent.order_number}`);
      if (extraInstruction.trim()) specialInstructionParts.push(extraInstruction.trim());
      const specialInstruction = specialInstructionParts.join(" | ");

      // 2. Create the child order row in our DB.
      const { data: newOrder, error: insErr } = await supabase
        .from("orders")
        .insert({
          store_id: parent.store_id,
          customer_id: parent.customer_id,
          order_number: exchangeOrderNumber,
          source: "exchange",
          is_exchange: true,
          parent_order_id: parent.id,
          status: "ready_to_ship",
          fulfillment_type: "delivery",
          payment_status: cod > 0 ? "cod" : "paid",
          payment_method: cod > 0 ? "Cash on Delivery" : "Exchange (no charge)",
          subtotal: cod,
          total: cod,
          amount_to_collect: cod,
          item_weight: Number(itemWeight) || 0.5,
          item_qty: 1,
          item_type: 2,
          delivery_type: 48,
          customer_name: recipientName,
          customer_phone: recipientPhone,
          customer_address: recipientAddress,
          customer_city: parent.customer_city,
          customer_email: parent.customer_email,
          pathao_recipient_city: Number(cityId),
          pathao_recipient_zone: Number(zoneId),
          pathao_recipient_area: areaId ? Number(areaId) : null,
          special_instruction: specialInstruction,
          notes: `Exchange parcel for order #${parent.order_number}`,
        } as any)
        .select("id")
        .single();
      if (insErr || !newOrder) throw insErr || new Error("Failed to create exchange order");

      // 3. Dispatch to Pathao via existing edge function.
      const selectedStore = pathaoStores.find(
        (s) => String(s.pathao_store_id) === selectedPathaoStore
      );
      const integrationId = selectedStore?.integration_id || parent.pathao_integration_id || undefined;

      const { data: dispatchData, error: dispatchErr } = await supabase.functions.invoke(
        "pathao-courier",
        {
          body: {
            action: "create_order",
            integration_id: integrationId,
            order_id: newOrder.id,
            order_payload: {
              store_id: Number(selectedPathaoStore),
              merchant_order_id: exchangeOrderNumber,
              recipient_name: recipientName,
              recipient_phone: recipientPhone,
              recipient_address: recipientAddress,
              recipient_city: Number(cityId),
              recipient_zone: Number(zoneId),
              recipient_area: areaId ? Number(areaId) : undefined,
              delivery_type: 48,
              item_type: 2,
              item_quantity: 1,
              item_weight: Number(itemWeight) || 0.5,
              amount_to_collect: cod,
              special_instruction: specialInstruction,
            },
          },
        }
      );
      if (dispatchErr) throw dispatchErr;

      const consignmentId: string | null =
        dispatchData?.data?.consignment_id || dispatchData?.consignment_id || null;

      // 4. Timeline + audit on both orders.
      await addOrderTimeline([
        {
          order_id: parent.id,
          event: "exchange_created",
          description: `Exchange parcel created → #${exchangeOrderNumber}${consignmentId ? ` (Pathao ${consignmentId})` : ""}`,
          metadata: {
            exchange_order_id: newOrder.id,
            exchange_order_number: exchangeOrderNumber,
            consignment_id: consignmentId,
            cod,
          },
        },
        {
          order_id: newOrder.id,
          event: "created_as_exchange",
          description: `Exchange parcel for original order #${parent.order_number}`,
          metadata: {
            parent_order_id: parent.id,
            parent_order_number: parent.order_number,
            consignment_id: consignmentId,
            cod,
          },
        },
      ]);

      await logAction("exchange_parcel_created", "order", newOrder.id, {
        parent_order_id: parent.id,
        parent_order_number: parent.order_number,
        exchange_order_number: exchangeOrderNumber,
        consignment_id: consignmentId,
        amount_to_collect: cod,
        pickup: pickupDescription,
        deliver: deliverDescription,
      });

      toast({
        title: "Exchange parcel created",
        description: consignmentId
          ? `Pathao consignment: ${consignmentId}`
          : "Order created, but Pathao did not return a consignment ID",
      });
      onCreated?.(newOrder.id, consignmentId);
      onOpenChange(false);
    } catch (err: any) {
      toast({
        title: "Exchange failed",
        description: err?.message || String(err),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  /* ─── Render ─── */
  const showPicker = pickerMode && !parent;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        showPicker
          ? "New Exchange Parcel"
          : `Exchange Parcel — for #${parent?.order_number || "…"}`
      }
    >
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
        <p className="text-xs text-muted-foreground -mt-2">
          Pathao picks up the original item and delivers a replacement in one trip.
        </p>
        {showPicker && (
          <div className="space-y-2">
            <Label>Find original delivered order</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by order #, customer name or phone…"
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                className="pl-8"
              />
            </div>
            {pickerLoading && (
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Searching…
              </div>
            )}
            <div className="border border-border rounded-md divide-y divide-border max-h-60 overflow-y-auto">
              {pickerResults.length === 0 && !pickerLoading && pickerQuery.length >= 2 && (
                <div className="text-xs text-muted-foreground p-3">No delivered orders found.</div>
              )}
              {pickerResults.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setParent(o)}
                  className="w-full text-left p-2 hover:bg-muted/50 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">#{o.order_number}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {o.customer_name || "—"} · {o.customer_phone || "—"}
                    </div>
                  </div>
                  <Badge variant="outline" className="capitalize">{o.status}</Badge>
                </button>
              ))}
            </div>
          </div>
        )}

        {parent && (
          <>
            {pickerMode && (
              <div className="flex items-center justify-between rounded-md border border-border p-2 bg-muted/30">
                <div className="text-sm">
                  Original: <span className="font-medium">#{parent.order_number}</span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setParent(null)} className="gap-1">
                  <RefreshCw className="h-3.5 w-3.5" /> Change
                </Button>
              </div>
            )}

            {/* Pathao store */}
            <div className="space-y-1.5">
              <Label>Pathao Pickup Store</Label>
              <Select value={selectedPathaoStore} onValueChange={setSelectedPathaoStore}>
                <SelectTrigger><SelectValue placeholder="Select store" /></SelectTrigger>
                <SelectContent>
                  {pathaoStores.map((s) => (
                    <SelectItem key={s.pathao_store_id} value={String(s.pathao_store_id)}>
                      {s.store_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Recipient */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Recipient Name</Label>
                <Input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Recipient Phone</Label>
                <Input value={recipientPhone} onChange={(e) => setRecipientPhone(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Recipient Address</Label>
              <Textarea
                value={recipientAddress}
                onChange={(e) => setRecipientAddress(e.target.value)}
                rows={2}
              />
            </div>

            {/* Location */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>City</Label>
                <SearchableSelect
                  value={cityId}
                  onChange={(v) => { setCityId(v); setZoneId(""); setAreaId(""); }}
                  options={cityOptions}
                  placeholder="Select city"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Zone</Label>
                <SearchableSelect
                  value={zoneId}
                  onChange={(v) => { setZoneId(v); setAreaId(""); }}
                  options={zoneOptions}
                  placeholder="Select zone"
                  disabled={!cityId}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Area</Label>
                <SearchableSelect
                  value={areaId}
                  onChange={setAreaId}
                  options={areaOptions}
                  placeholder="Optional"
                  disabled={!zoneId}
                />
              </div>
            </div>

            {/* Exchange items */}
            <div className="space-y-1.5">
              <Label>Pickup from customer</Label>
              <Textarea
                value={pickupDescription}
                onChange={(e) => setPickupDescription(e.target.value)}
                placeholder="What the courier should collect — e.g. 'Red Saree, size M'"
                rows={2}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Deliver to customer</Label>
              <Textarea
                value={deliverDescription}
                onChange={(e) => setDeliverDescription(e.target.value)}
                placeholder="What the courier should drop off — e.g. 'Red Saree, size L'"
                rows={2}
              />
            </div>

            {/* Weight + COD */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Weight (kg)</Label>
                <Input
                  type="number" min="0.5" max="10" step="0.1"
                  value={itemWeight}
                  onChange={(e) => setItemWeight(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Amount to Collect (BDT)</Label>
                <Input
                  type="number" min="0" step="1"
                  value={amountToCollect}
                  onChange={(e) => setAmountToCollect(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button" variant="outline" size="sm"
                onClick={() => setAmountToCollect("0")}
              >
                Even Swap (0)
              </Button>
              <Button
                type="button" variant="outline" size="sm"
                onClick={() => setAmountToCollect(String(shippingInside))}
              >
                Inside Dhaka shipping ({shippingInside})
              </Button>
              <Button
                type="button" variant="outline" size="sm"
                onClick={() => setAmountToCollect(String(shippingOutside))}
              >
                Outside Dhaka shipping ({shippingOutside})
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label>Extra Instruction (optional)</Label>
              <Input
                value={extraInstruction}
                onChange={(e) => setExtraInstruction(e.target.value)}
                placeholder="Anything else the rider should know"
              />
            </div>
          </>
        )}
      </div>

      <DialogFooter className="mt-4">
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={submitting || !canSubmit} className="gap-2">
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Create Exchange Parcel
        </Button>
      </DialogFooter>
    </ResponsiveDialog>
  );
}
