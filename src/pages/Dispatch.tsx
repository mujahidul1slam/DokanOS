import { useEffect, useState, useCallback } from "react";
import {
  Truck, Send, RefreshCw, Loader2, MapPin, Package, CheckCircle2,
  Search, ExternalLink,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import StatusBadge from "@/components/StatusBadge";

/* ─── Types ─── */
interface DispatchOrder {
  id: string;
  order_number: string;
  total: number;
  status: string;
  store_id: string | null;
  customers: { name: string; phone: string | null; address: string | null; city: string | null; zone: string | null; area: string | null } | null;
  stores: { name: string } | null;
  itemCount: number;
  consignment_id: string | null;
  tracking_status: string | null;
  amount_to_collect: number | null;
  pathao_store_id: number | null;
  pathao_recipient_city: number | null;
  pathao_recipient_zone: number | null;
  pathao_recipient_area: number | null;
  item_weight: number | null;
  special_instruction: string | null;
}

interface PathaoIntegration {
  id: string;
  name: string;
  is_active: boolean;
}

interface PathaoStore {
  pathao_store_id: number;
  store_name: string;
  integration_id: string | null;
}

interface StoreLink {
  woo_store_id: string;
  pathao_integration_id: string;
  default_pathao_store_id: number | null;
}

interface City { city_id: number; city_name: string }
interface Zone { zone_id: number; zone_name: string }
interface Area { area_id: number; area_name: string }

/* ─── Component ─── */
const Dispatch = () => {
  const [tab, setTab] = useState("pending");
  const [orders, setOrders] = useState<DispatchOrder[]>([]);
  const [shippedOrders, setShippedOrders] = useState<DispatchOrder[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Dispatch dialog
  const [dispatchDialogOpen, setDispatchDialogOpen] = useState(false);
  const [dispatchOrders, setDispatchOrders] = useState<DispatchOrder[]>([]);
  const [dispatching, setDispatching] = useState(false);

  // Pathao integrations + stores
  const [pathaoIntegrations, setPathaoIntegrations] = useState<PathaoIntegration[]>([]);
  const [selectedIntegration, setSelectedIntegration] = useState<string>("");
  const [pathaoStores, setPathaoStores] = useState<PathaoStore[]>([]);
  const [selectedPathaoStore, setSelectedPathaoStore] = useState<string>("");
  const [storeLinks, setStoreLinks] = useState<StoreLink[]>([]);

  // Location data
  const [cities, setCities] = useState<City[]>([]);
  const [zonesMap, setZonesMap] = useState<Record<number, Zone[]>>({});
  const [areasMap, setAreasMap] = useState<Record<number, Area[]>>({});

  // Per-order overrides in dispatch dialog
  const [orderOverrides, setOrderOverrides] = useState<Record<string, {
    city_id: string; zone_id: string; area_id: string;
    amount_to_collect: string; item_weight: string; special_instruction: string;
    recipient_name: string; recipient_phone: string; recipient_address: string;
  }>>({});

  // Tracking
  const [trackingLoading, setTrackingLoading] = useState(false);

  const { toast } = useToast();

  /* ─── Load orders ─── */
  const loadOrders = useCallback(async () => {
    const [{ data: pending }, { data: shipped }] = await Promise.all([
      supabase
        .from("orders")
        .select("id, order_number, total, status, store_id, consignment_id, tracking_status, amount_to_collect, pathao_store_id, pathao_recipient_city, pathao_recipient_zone, pathao_recipient_area, item_weight, special_instruction, customers(name, phone, address, city, zone, area), stores(name), order_items(id)")
        .eq("status", "processing")
        .order("created_at", { ascending: false }),
      supabase
        .from("orders")
        .select("id, order_number, total, status, store_id, consignment_id, tracking_status, amount_to_collect, pathao_store_id, pathao_recipient_city, pathao_recipient_zone, pathao_recipient_area, item_weight, special_instruction, customers(name, phone, address, city, zone, area), stores(name), order_items(id)")
        .not("consignment_id", "is", null)
        .not("status", "in", '("delivered","completed","cancelled","returned")')
        .order("created_at", { ascending: false }),
    ]);

    const mapOrders = (data: any[]) =>
      data.map((o: any) => ({
        ...o,
        customers: o.customers,
        stores: o.stores,
        itemCount: o.order_items?.length || 0,
      }));

    setOrders(mapOrders(pending || []));
    setShippedOrders(mapOrders(shipped || []));
    setLoading(false);
  }, []);

  /* ─── Load Pathao integrations + linked stores ─── */
  const loadPathaoData = useCallback(async () => {
    const [{ data: integrations }, { data: links }] = await Promise.all([
      supabase.from("pathao_integrations").select("id, name, is_active").eq("is_active", true).order("name"),
      supabase.from("pathao_store_links").select("woo_store_id, pathao_integration_id, default_pathao_store_id"),
    ]);
    setPathaoIntegrations((integrations || []) as PathaoIntegration[]);
    setStoreLinks((links || []) as StoreLink[]);
    if (integrations && integrations.length > 0 && !selectedIntegration) {
      setSelectedIntegration(integrations[0].id);
    }
  }, [selectedIntegration]);

  /* ─── Load Pathao merchant stores for selected integration ─── */
  const loadPathaoStores = useCallback(async (integrationId: string) => {
    if (!integrationId) { setPathaoStores([]); return; }
    const { data } = await supabase
      .from("pathao_stores")
      .select("pathao_store_id, store_name, integration_id")
      .eq("is_active", true)
      .eq("integration_id", integrationId);
    setPathaoStores((data || []) as PathaoStore[]);
    if (data && data.length > 0) {
      setSelectedPathaoStore(String(data[0].pathao_store_id));
    } else {
      setSelectedPathaoStore("");
    }
  }, []);

  /* ─── Load cities from cache ─── */
  const loadCities = useCallback(async () => {
    const { data } = await supabase
      .from("pathao_cities")
      .select("city_id, city_name")
      .order("city_name");
    setCities(data || []);
  }, []);

  useEffect(() => {
    loadOrders();
    loadPathaoData();
    loadCities();
  }, [loadOrders, loadPathaoData, loadCities]);

  // Reload merchant stores whenever the selected integration changes
  useEffect(() => {
    if (selectedIntegration) loadPathaoStores(selectedIntegration);
  }, [selectedIntegration, loadPathaoStores]);

  /* ─── Fetch & sync Pathao stores from API ─── */
  const syncPathaoStores = async () => {
    if (!selectedIntegration) {
      toast({ title: "Select a Pathao integration first", variant: "destructive" });
      return;
    }
    try {
      await supabase.functions.invoke("pathao-courier", {
        body: { action: "get_stores", integration_id: selectedIntegration },
      });
      await loadPathaoStores(selectedIntegration);
      toast({ title: "Pathao stores synced" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  /* ─── Fetch & sync cities ─── */
  const syncCities = async () => {
    try {
      const { data } = await supabase.functions.invoke("pathao-courier", {
        body: { action: "get_cities" },
      });
      await loadCities();
      toast({ title: `${(data?.data || []).length} cities synced` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  /* ─── Fetch zones for a city ─── */
  const fetchZones = async (cityId: number) => {
    if (zonesMap[cityId]) return;
    // Check cache first
    const { data: cached } = await supabase
      .from("pathao_zones")
      .select("zone_id, zone_name")
      .eq("city_id", cityId)
      .order("zone_name");
    if (cached && cached.length > 0) {
      setZonesMap((prev) => ({ ...prev, [cityId]: cached }));
      return;
    }
    // Fetch from API
    const { data } = await supabase.functions.invoke("pathao-courier", {
      body: { action: "get_zones", city_id: cityId },
    });
    const zones = data?.data || [];
    setZonesMap((prev) => ({ ...prev, [cityId]: zones.map((z: any) => ({ zone_id: z.zone_id, zone_name: z.zone_name })) }));
  };

  /* ─── Fetch areas for a zone ─── */
  const fetchAreas = async (zoneId: number) => {
    if (areasMap[zoneId]) return;
    const { data: cached } = await supabase
      .from("pathao_areas")
      .select("area_id, area_name")
      .eq("zone_id", zoneId)
      .order("area_name");
    if (cached && cached.length > 0) {
      setAreasMap((prev) => ({ ...prev, [zoneId]: cached }));
      return;
    }
    const { data } = await supabase.functions.invoke("pathao-courier", {
      body: { action: "get_areas", zone_id: zoneId },
    });
    const areas = data?.data || [];
    setAreasMap((prev) => ({ ...prev, [zoneId]: areas.map((a: any) => ({ area_id: a.area_id, area_name: a.area_name })) }));
  };

  /* ─── Selection helpers ─── */
  const filteredPending = orders.filter((o) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      o.order_number.toLowerCase().includes(q) ||
      (o.customers?.name || "").toLowerCase().includes(q) ||
      (o.customers?.phone || "").toLowerCase().includes(q)
    );
  });

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleAll = () => {
    if (selected.size === filteredPending.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredPending.map((o) => o.id)));
    }
  };

  /* ─── Open dispatch dialog ─── */
  const openDispatch = (orderIds: string[]) => {
    const toDispatch = orders.filter((o) => orderIds.includes(o.id));
    setDispatchOrders(toDispatch);

    // Initialize overrides with customer data
    const overrides: typeof orderOverrides = {};
    for (const o of toDispatch) {
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
    setDispatchDialogOpen(true);
  };

  /* ─── Dispatch orders to Pathao ─── */
  const handleDispatch = async () => {
    if (!selectedPathaoStore) {
      toast({ title: "Select a Pathao store first", variant: "destructive" });
      return;
    }

    // Validate all orders have required fields
    for (const o of dispatchOrders) {
      const ov = orderOverrides[o.id];
      if (!ov?.recipient_name || !ov?.recipient_phone || !ov?.recipient_address || !ov?.city_id || !ov?.zone_id) {
        toast({
          title: "Missing info",
          description: `Order #${o.order_number} is missing recipient details or location`,
          variant: "destructive",
        });
        return;
      }
    }

    setDispatching(true);

    try {
      const bulkPayload = dispatchOrders.map((o) => {
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
            delivery_type: 48,
            item_type: 2,
            item_quantity: o.itemCount || 1,
            item_weight: Number(ov.item_weight) || 0.5,
            amount_to_collect: Number(ov.amount_to_collect) || 0,
            special_instruction: ov.special_instruction || undefined,
          },
        };
      });

      const { data, error } = await supabase.functions.invoke("pathao-courier", {
        body: { action: "create_bulk", orders: bulkPayload },
      });

      if (error) throw error;

      const results = data?.data?.results || [];
      const succeeded = results.filter((r: any) => r.success).length;
      const failed = results.filter((r: any) => !r.success);

      if (failed.length > 0) {
        toast({
          title: `${succeeded} dispatched, ${failed.length} failed`,
          description: failed.map((f: any) => f.error).join("; ").slice(0, 200),
          variant: failed.length === results.length ? "destructive" : "default",
        });
      } else {
        toast({ title: `${succeeded} order(s) dispatched to Pathao!` });
      }

      setDispatchDialogOpen(false);
      setSelected(new Set());
      loadOrders();
    } catch (err: any) {
      toast({ title: "Dispatch failed", description: err.message, variant: "destructive" });
    } finally {
      setDispatching(false);
    }
  };

  /* ─── Track all active shipments ─── */
  const handleTrackAll = async () => {
    setTrackingLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("pathao-track");
      if (error) throw error;
      const info = data?.data || {};
      toast({
        title: "Tracking updated",
        description: `Checked ${info.total || 0} shipments, ${info.updated || 0} updated`,
      });
      loadOrders();
    } catch (err: any) {
      toast({ title: "Tracking failed", description: err.message, variant: "destructive" });
    } finally {
      setTrackingLoading(false);
    }
  };

  /* ─── Track single order ─── */
  const handleTrackOne = async (consignmentId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("pathao-courier", {
        body: { action: "track_order", consignment_id: consignmentId },
      });
      if (error) throw error;
      toast({ title: `Status: ${data?.data?.order_status || "Unknown"}` });
      loadOrders();
    } catch (err: any) {
      toast({ title: "Track failed", description: err.message, variant: "destructive" });
    }
  };

  /* ─── Update override helper ─── */
  const updateOverride = (orderId: string, field: string, value: string) => {
    setOrderOverrides((prev) => ({
      ...prev,
      [orderId]: { ...prev[orderId], [field]: value },
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Courier Dispatch</h1>
          <p className="text-sm text-muted-foreground">
            Dispatch & track orders via Pathao Courier
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={syncPathaoStores}>
            <RefreshCw className="h-4 w-4 mr-1" /> Sync Stores
          </Button>
          <Button variant="outline" size="sm" onClick={syncCities}>
            <MapPin className="h-4 w-4 mr-1" /> Sync Locations
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleTrackAll}
            disabled={trackingLoading}
          >
            {trackingLoading ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1" />
            )}
            Update Tracking
          </Button>
        </div>
      </div>

      {/* Pathao Store Selector */}
      <div className="flex items-center gap-4 rounded-lg border border-border bg-card p-4">
        <Label className="text-sm font-medium whitespace-nowrap">Pathao Store:</Label>
        {pathaoStores.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No Pathao stores found.{" "}
            <button onClick={syncPathaoStores} className="text-primary underline">
              Sync now
            </button>
          </p>
        ) : (
          <Select value={selectedPathaoStore} onValueChange={setSelectedPathaoStore}>
            <SelectTrigger className="w-[280px]">
              <SelectValue placeholder="Select Pathao store" />
            </SelectTrigger>
            <SelectContent>
              {pathaoStores.map((s) => (
                <SelectItem key={s.pathao_store_id} value={String(s.pathao_store_id)}>
                  {s.store_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="pending" className="gap-1">
            <Package className="h-4 w-4" />
            Pending ({orders.length})
          </TabsTrigger>
          <TabsTrigger value="shipped" className="gap-1">
            <Truck className="h-4 w-4" />
            In Transit ({shippedOrders.length})
          </TabsTrigger>
        </TabsList>

        {/* ── Pending Tab ── */}
        <TabsContent value="pending" className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search order, customer, phone..."
                className="pl-9"
              />
            </div>
            <Button
              disabled={selected.size === 0}
              onClick={() => openDispatch(Array.from(selected))}
              className="gap-2"
            >
              <Send className="h-4 w-4" />
              Dispatch {selected.size > 0 && `(${selected.size})`}
            </Button>
          </div>

          {filteredPending.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card py-16">
              <Truck className="h-10 w-10 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">No orders pending dispatch</p>
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-secondary hover:bg-secondary">
                    <TableHead className="w-10">
                      <Checkbox
                        checked={filteredPending.length > 0 && selected.size === filteredPending.length}
                        onCheckedChange={toggleAll}
                      />
                    </TableHead>
                    <TableHead>Order</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Store</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPending.map((order) => (
                    <TableRow key={order.id} className={selected.has(order.id) ? "bg-primary/5" : ""}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(order.id)}
                          onCheckedChange={() => toggle(order.id)}
                        />
                      </TableCell>
                      <TableCell className="font-medium text-foreground">
                        #{order.order_number}
                      </TableCell>
                      <TableCell>
                        <div className="text-foreground">{order.customers?.name || "—"}</div>
                        <div className="text-xs text-muted-foreground">{order.customers?.phone || ""}</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-muted-foreground max-w-[200px] truncate">
                          {order.customers?.address || "—"}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {order.stores?.name || "—"}
                      </TableCell>
                      <TableCell>{order.itemCount}</TableCell>
                      <TableCell className="text-right font-medium">
                        ৳{Number(order.total).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openDispatch([order.id])}
                          title="Dispatch single"
                        >
                          <Send className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ── Shipped / In Transit Tab ── */}
        <TabsContent value="shipped" className="space-y-4">
          {shippedOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card py-16">
              <CheckCircle2 className="h-10 w-10 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">No active shipments</p>
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-secondary hover:bg-secondary">
                    <TableHead>Order</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Consignment</TableHead>
                    <TableHead>Tracking Status</TableHead>
                    <TableHead>Order Status</TableHead>
                    <TableHead className="text-right">COD</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shippedOrders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">#{order.order_number}</TableCell>
                      <TableCell>
                        <div className="text-foreground">{order.customers?.name || "—"}</div>
                        <div className="text-xs text-muted-foreground">{order.customers?.phone || ""}</div>
                      </TableCell>
                      <TableCell>
                        {order.consignment_id ? (
                          <a
                            href={`https://merchant.pathao.com/tracking?consignment_id=${order.consignment_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                          >
                            {order.consignment_id}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        <TrackingBadge status={order.tracking_status} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={order.status} />
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        ৳{Number(order.amount_to_collect || order.total).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => order.consignment_id && handleTrackOne(order.consignment_id)}
                          title="Refresh tracking"
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Dispatch Dialog ── */}
      <Dialog open={dispatchDialogOpen} onOpenChange={setDispatchDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Dispatch to Pathao ({dispatchOrders.length} order{dispatchOrders.length > 1 ? "s" : ""})</DialogTitle>
            <DialogDescription>
              Review and confirm recipient details before dispatching.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {dispatchOrders.map((order) => {
              const ov = orderOverrides[order.id] || {
                city_id: "", zone_id: "", area_id: "",
                amount_to_collect: "", item_weight: "", special_instruction: "",
                recipient_name: "", recipient_phone: "", recipient_address: "",
              };
              const cityId = ov.city_id ? Number(ov.city_id) : 0;
              const zoneId = ov.zone_id ? Number(ov.zone_id) : 0;
              const zones = zonesMap[cityId] || [];
              const areas = areasMap[zoneId] || [];

              return (
                <div
                  key={order.id}
                  className="rounded-lg border border-border p-4 space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium text-foreground">
                        #{order.order_number}
                      </span>
                      <span className="ml-2 text-sm text-muted-foreground">
                        — ৳{Number(order.total).toLocaleString()}
                      </span>
                    </div>
                    <Badge variant="outline">{order.itemCount} item(s)</Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Recipient Name</Label>
                      <Input
                        value={ov.recipient_name || ""}
                        onChange={(e) => updateOverride(order.id, "recipient_name", e.target.value)}
                        placeholder="Name"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Phone</Label>
                      <Input
                        value={ov.recipient_phone || ""}
                        onChange={(e) => updateOverride(order.id, "recipient_phone", e.target.value)}
                        placeholder="01XXXXXXXXX"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Address</Label>
                    <Input
                      value={ov.recipient_address || ""}
                      onChange={(e) => updateOverride(order.id, "recipient_address", e.target.value)}
                      placeholder="Full address"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">City</Label>
                      <Select
                        value={ov.city_id || ""}
                        onValueChange={(val) => {
                          updateOverride(order.id, "city_id", val);
                          updateOverride(order.id, "zone_id", "");
                          updateOverride(order.id, "area_id", "");
                          fetchZones(Number(val));
                        }}
                      >
                        <SelectTrigger><SelectValue placeholder="Select city" /></SelectTrigger>
                        <SelectContent>
                          {cities.map((c) => (
                            <SelectItem key={c.city_id} value={String(c.city_id)}>
                              {c.city_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Zone</Label>
                      <Select
                        value={ov.zone_id || ""}
                        onValueChange={(val) => {
                          updateOverride(order.id, "zone_id", val);
                          updateOverride(order.id, "area_id", "");
                          fetchAreas(Number(val));
                        }}
                        disabled={!ov.city_id}
                      >
                        <SelectTrigger><SelectValue placeholder="Select zone" /></SelectTrigger>
                        <SelectContent>
                          {zones.map((z) => (
                            <SelectItem key={z.zone_id} value={String(z.zone_id)}>
                              {z.zone_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Area</Label>
                      <Select
                        value={ov.area_id || ""}
                        onValueChange={(val) => updateOverride(order.id, "area_id", val)}
                        disabled={!ov.zone_id}
                      >
                        <SelectTrigger><SelectValue placeholder="Select area" /></SelectTrigger>
                        <SelectContent>
                          {areas.map((a) => (
                            <SelectItem key={a.area_id} value={String(a.area_id)}>
                              {a.area_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">COD Amount</Label>
                      <Input
                        type="number"
                        value={ov.amount_to_collect || ""}
                        onChange={(e) => updateOverride(order.id, "amount_to_collect", e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Weight (kg)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={ov.item_weight || ""}
                        onChange={(e) => updateOverride(order.id, "item_weight", e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Special Instruction</Label>
                      <Input
                        value={ov.special_instruction || ""}
                        onChange={(e) => updateOverride(order.id, "special_instruction", e.target.value)}
                        placeholder="Optional"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDispatchDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleDispatch} disabled={dispatching} className="gap-2">
              {dispatching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Dispatch {dispatchOrders.length} Order(s)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

/* ─── Tracking Badge ─── */
function TrackingBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;

  const colorMap: Record<string, string> = {
    "Pickup Pending": "bg-amber-500/15 text-amber-400 border-amber-500/20",
    "Picked": "bg-primary/15 text-primary border-primary/20",
    "In Transit": "bg-primary/15 text-primary border-primary/20",
    "Delivered": "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
    "Partial Delivered": "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
    "Return": "bg-red-500/15 text-red-400 border-red-500/20",
    "Returned": "bg-red-500/15 text-red-400 border-red-500/20",
    "On Hold": "bg-amber-500/15 text-amber-400 border-amber-500/20",
    "Cancelled": "bg-zinc-500/15 text-zinc-400 border-zinc-500/20",
  };

  return (
    <Badge className={colorMap[status] || "bg-muted text-muted-foreground"}>
      {status}
    </Badge>
  );
}

export default Dispatch;
