import { useEffect, useState, useMemo, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { format } from "date-fns";
import {
  Search, ExternalLink, MoreHorizontal, Send, CalendarIcon,
  RefreshCw, Loader2, MapPin, Package, Truck, ShoppingCart, CheckSquare,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { DateRange } from "react-day-picker";
import OrderDetailSheet from "@/components/orders/OrderDetailSheet";
import DispatchDialog from "@/components/orders/DispatchDialog";
import {
  SourceBadge, PaymentBadge, FulfillmentBadge, TrackingBadge,
} from "@/components/orders/OrderBadges";
import { TableSkeleton } from "@/components/ui/loading-states";

interface OrderRow {
  id: string;
  order_number: string;
  total: number;
  status: string;
  source: string;
  payment_method: string | null;
  payment_status: string;
  consignment_id: string | null;
  tracking_status: string | null;
  created_at: string;
  amount_to_collect: number | null;
  pathao_recipient_city: number | null;
  pathao_recipient_zone: number | null;
  pathao_recipient_area: number | null;
  pathao_store_id: number | null;
  item_weight: number | null;
  special_instruction: string | null;
  store_id: string | null;
  customers: { name: string; phone: string | null; address: string | null } | null;
  stores: { name: string } | null;
  itemCount: number;
  productItems: { name: string; qty: number }[];
}

interface StoreOption { id: string; name: string }

const PAGE_SIZE = 10;

const Orders = () => {
  const { role } = useAuth();
  const canWrite = role === "admin" || role === "staff";
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [storeFilter, setStoreFilter] = useState("all");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);
  const [tab, setTab] = useState("all");
  const [stores, setStores] = useState<StoreOption[]>([]);

  // Dispatch
  const [dispatchDialogOpen, setDispatchDialogOpen] = useState(false);
  const [dispatchOrderIds, setDispatchOrderIds] = useState<string[]>([]);

  // Tracking
  const [trackingLoading, setTrackingLoading] = useState(false);

  // Bulk status
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkUpdating, setBulkUpdating] = useState(false);

  const { toast } = useToast();

  const loadOrders = useCallback(async () => {
    const { data } = await supabase
      .from("orders")
      .select("id, order_number, total, status, source, payment_method, payment_status, consignment_id, tracking_status, created_at, store_id, amount_to_collect, pathao_recipient_city, pathao_recipient_zone, pathao_recipient_area, pathao_store_id, item_weight, special_instruction, customers(name, phone, address), stores(name), order_items(id, product_name, quantity)")
      .order("created_at", { ascending: false });

    const mapped = (data || []).map((o: any) => ({
      ...o,
      itemCount: o.order_items?.length || 0,
      productItems: (o.order_items || [])
        .filter((i: any) => i.product_name)
        .map((i: any) => ({ name: i.product_name, qty: i.quantity || 1 })),
    }));
    setOrders(mapped as OrderRow[]);
    setLoading(false);
  }, []);

  const loadStores = useCallback(async () => {
    const { data } = await supabase.from("stores").select("id, name").order("name");
    setStores(data || []);
  }, []);

  useEffect(() => { loadOrders(); loadStores(); }, [loadOrders, loadStores]);

  /* ─── Filtering ─── */
  const filtered = useMemo(() => {
    return orders.filter((o) => {
      const q = search.toLowerCase();
      const matchSearch = !q ||
        o.order_number.toLowerCase().includes(q) ||
        (o.customers?.name || "").toLowerCase().includes(q) ||
        (o.customers?.phone || "").toLowerCase().includes(q);

      const matchStatus = statusFilter === "all" || o.status === statusFilter;
      const matchPayment = paymentFilter === "all" || o.payment_status === paymentFilter;
      const matchSource = sourceFilter === "all" || o.source === sourceFilter;
      const matchStore = storeFilter === "all" || o.store_id === storeFilter;

      let matchDate = true;
      if (dateRange?.from) {
        const d = new Date(o.created_at);
        matchDate = d >= dateRange.from;
        if (dateRange.to) {
          const end = new Date(dateRange.to);
          end.setHours(23, 59, 59, 999);
          matchDate = matchDate && d <= end;
        }
      }

      // Tab filtering
      if (tab === "pending") return matchSearch && matchStore && o.status === "processing" && !o.consignment_id;
      if (tab === "in-transit") return matchSearch && matchStore && !!o.consignment_id && !["delivered", "completed", "cancelled", "returned"].includes(o.status);

      return matchSearch && matchStatus && matchPayment && matchSource && matchStore && matchDate;
    });
  }, [orders, search, statusFilter, paymentFilter, sourceFilter, storeFilter, dateRange, tab]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [search, statusFilter, paymentFilter, sourceFilter, storeFilter, dateRange, tab]);
  useEffect(() => { setSelected(new Set()); }, [tab]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };
  const toggleAll = () => {
    if (selected.size === paginated.length) setSelected(new Set());
    else setSelected(new Set(paginated.map((o) => o.id)));
  };

  /* ─── Dispatch helpers ─── */
  const openDispatch = (ids: string[]) => {
    setDispatchOrderIds(ids);
    setDispatchDialogOpen(true);
  };

  const dispatchOrders = useMemo(() =>
    orders.filter((o) => dispatchOrderIds.includes(o.id)),
    [orders, dispatchOrderIds]
  );

  /* ─── Pathao sync helpers ─── */
  const syncPathaoStores = async () => {
    try {
      await supabase.functions.invoke("pathao-courier", { body: { action: "get_stores" } });
      toast({ title: "Pathao stores synced" });
    } catch (err: any) { toast({ title: "Error", description: err.message, variant: "destructive" }); }
  };

  const syncCities = async () => {
    try {
      const { data } = await supabase.functions.invoke("pathao-courier", { body: { action: "get_cities" } });
      toast({ title: `${(data?.data || []).length} cities synced` });
    } catch (err: any) { toast({ title: "Error", description: err.message, variant: "destructive" }); }
  };

  const handleTrackAll = async () => {
    setTrackingLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("pathao-track");
      if (error) throw error;
      toast({ title: "Tracking updated", description: `Checked ${data?.data?.total || 0}, updated ${data?.data?.updated || 0}` });
      loadOrders();
    } catch (err: any) { toast({ title: "Tracking failed", description: err.message, variant: "destructive" }); }
    finally { setTrackingLoading(false); }
  };

  const handleTrackOne = async (consignmentId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("pathao-courier", { body: { action: "track_order", consignment_id: consignmentId } });
      if (error) throw error;
      toast({ title: `Status: ${data?.data?.order_status || "Unknown"}` });
      loadOrders();
    } catch (err: any) { toast({ title: "Track failed", description: err.message, variant: "destructive" }); }
  };

  const handleBulkStatusUpdate = async () => {
    if (!bulkStatus || selected.size === 0) return;
    setBulkUpdating(true);
    try {
      const ids = Array.from(selected);
      await supabase
        .from("orders")
        .update({ status: bulkStatus })
        .in("id", ids);

      // Add timeline entries
      const timelineEntries = ids.map((id) => ({
        order_id: id,
        event: "status_changed",
        description: `Bulk status update to "${bulkStatus}"`,
      }));
      await supabase.from("order_timeline").insert(timelineEntries);

      toast({ title: `${ids.length} order(s) updated to "${bulkStatus}"` });
      setSelected(new Set());
      setBulkStatus("");
      loadOrders();
    } catch {
      toast({ title: "Bulk update failed", variant: "destructive" });
    } finally {
      setBulkUpdating(false);
    }
  };

  if (loading) return (
    <div className="space-y-4">
      <div><h1 className="font-heading text-2xl font-semibold">Orders</h1></div>
      <TableSkeleton rows={10} cols={7} />
    </div>
  );

  const pendingCount = orders.filter((o) => o.status === "processing" && !o.consignment_id).length;
  const inTransitCount = orders.filter((o) => !!o.consignment_id && !["delivered", "completed", "cancelled", "returned"].includes(o.status)).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Orders</h1>
          <p className="text-sm text-muted-foreground">Unified view — all channels, dispatch & tracking</p>
        </div>
        <div className="flex items-center gap-2">
          {tab === "in-transit" && (
            <Button variant="outline" size="sm" onClick={handleTrackAll} disabled={trackingLoading}>
              {trackingLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              Update Tracking
            </Button>
          )}
          {canWrite && (tab === "pending" || tab === "all") && (
            <Button disabled={selected.size === 0} className="gap-2" onClick={() => openDispatch(Array.from(selected))}>
              <Send className="h-4 w-4" /> Dispatch {selected.size > 0 ? `(${selected.size})` : ""}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm"><MapPin className="h-4 w-4 mr-1" /> Pathao</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={syncPathaoStores}><RefreshCw className="h-4 w-4 mr-2" /> Sync Stores</DropdownMenuItem>
              <DropdownMenuItem onClick={syncCities}><MapPin className="h-4 w-4 mr-2" /> Sync Locations</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Bulk Action Bar */}
      {canWrite && selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
          <CheckSquare className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-medium">{selected.size} order{selected.size > 1 ? "s" : ""} selected</span>
          <div className="flex items-center gap-2 ml-auto">
            <Select value={bulkStatus} onValueChange={setBulkStatus}>
              <SelectTrigger className="w-[160px] h-9">
                <SelectValue placeholder="Change status to…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="processing">Processing</SelectItem>
                <SelectItem value="shipped">Shipped</SelectItem>
                <SelectItem value="delivered">Delivered</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="returned">Returned</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              disabled={!bulkStatus || bulkUpdating}
              onClick={handleBulkStatusUpdate}
            >
              {bulkUpdating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Apply
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all" className="gap-1.5"><ShoppingCart className="h-4 w-4" />All Orders ({orders.length})</TabsTrigger>
          <TabsTrigger value="pending" className="gap-1.5"><Package className="h-4 w-4" />Pending Dispatch ({pendingCount})</TabsTrigger>
          <TabsTrigger value="in-transit" className="gap-1.5"><Truck className="h-4 w-4" />In Transit ({inTransitCount})</TabsTrigger>
        </TabsList>

        {/* ── All Orders Tab ── */}
        <TabsContent value="all" className="space-y-4">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search ID, Name, or Phone..." className="pl-9" />
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn("gap-2 text-sm font-normal", !dateRange?.from && "text-muted-foreground")}>
                  <CalendarIcon className="h-4 w-4" />
                  {dateRange?.from ? (dateRange.to ? `${format(dateRange.from, "MMM d")} – ${format(dateRange.to, "MMM d")}` : format(dateRange.from, "MMM d, yyyy")) : "Date Range"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="range" selected={dateRange} onSelect={setDateRange} numberOfMonths={2} className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px]"><SelectValue placeholder="Fulfillment" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="processing">Processing</SelectItem>
                <SelectItem value="shipped">Shipped</SelectItem>
                <SelectItem value="delivered">Delivered</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="returned">Returned</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <Select value={paymentFilter} onValueChange={setPaymentFilter}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="Payment" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Payment</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="unpaid">Unpaid</SelectItem>
                <SelectItem value="cod">COD</SelectItem>
                <SelectItem value="partial">Partial</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="w-[130px]"><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                <SelectItem value="online">Online</SelectItem>
                <SelectItem value="pos">POS</SelectItem>
              </SelectContent>
            </Select>
            <Select value={storeFilter} onValueChange={setStoreFilter}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Store" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stores</SelectItem>
                {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* All Orders Table */}
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary hover:bg-secondary">
                  <TableHead className="w-10"><Checkbox checked={paginated.length > 0 && selected.size === paginated.length} onCheckedChange={toggleAll} /></TableHead>
                  <TableHead>Order Info</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Products</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Fulfillment</TableHead>
                  <TableHead>Courier Status</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.length === 0 ? (
                  <TableRow><TableCell colSpan={10} className="text-center py-12 text-muted-foreground">No orders found</TableCell></TableRow>
                ) : paginated.map((order) => (
                  <TableRow key={order.id} className="group">
                    <TableCell><Checkbox checked={selected.has(order.id)} onCheckedChange={() => toggleSelect(order.id)} /></TableCell>
                    <TableCell>
                      <div className="font-medium text-foreground">#{order.order_number}</div>
                      <div className="text-xs text-muted-foreground">{format(new Date(order.created_at), "MMM d, yyyy · h:mm a")}</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-foreground">{order.customers?.name || "—"}</div>
                      <div className="text-xs text-muted-foreground">{order.customers?.phone || "—"}</div>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-[200px]" title={order.productItems.map(p => `${p.name} ×${p.qty}`).join('\n')}>
                        {order.productItems.length === 0 ? (
                          <span className="text-xs text-muted-foreground italic">—</span>
                        ) : (
                          <div className="space-y-0.5">
                            {order.productItems.slice(0, 2).map((p, i) => (
                              <div key={i} className="text-sm truncate">
                                <span className="text-muted-foreground">×{p.qty}</span>{" "}
                                <span>{p.name}</span>
                              </div>
                            ))}
                            {order.productItems.length > 2 && (
                              <span className="text-xs text-muted-foreground">+{order.productItems.length - 2} more</span>
                            )}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell><SourceBadge source={order.source} /></TableCell>
                    <TableCell><PaymentBadge status={order.payment_status} /></TableCell>
                    <TableCell className="text-right font-medium text-foreground">৳{Number(order.total).toLocaleString()}</TableCell>
                    <TableCell><FulfillmentBadge status={order.status} /></TableCell>
                    <TableCell>
                      {order.consignment_id ? (
                        <div className="space-y-1">
                          <a href={`https://merchant.pathao.com/tracking?consignment_id=${order.consignment_id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                            {order.consignment_id}<ExternalLink className="h-3 w-3" />
                          </a>
                          <div><TrackingBadge status={order.tracking_status} /></div>
                        </div>
                      ) : <span className="text-xs text-muted-foreground italic">Not Dispatched</span>}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setDetailOrderId(order.id)}>View Details</DropdownMenuItem>
                          {order.status === "processing" && !order.consignment_id && (
                            <DropdownMenuItem onClick={() => openDispatch([order.id])}>
                              <Send className="h-4 w-4 mr-2" />Dispatch to Pathao
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem>Print Invoice</DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive">Cancel Order</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination page={page} totalPages={totalPages} filtered={filtered} setPage={setPage} />
        </TabsContent>

        {/* ── Pending Dispatch Tab ── */}
        <TabsContent value="pending" className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search order, customer, phone..." className="pl-9" />
            </div>
            <Select value={storeFilter} onValueChange={setStoreFilter}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Store" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stores</SelectItem>
                {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button disabled={selected.size === 0} onClick={() => openDispatch(Array.from(selected))} className="gap-2">
              <Send className="h-4 w-4" />Dispatch {selected.size > 0 && `(${selected.size})`}
            </Button>
          </div>
          {paginated.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card py-16">
              <Truck className="h-10 w-10 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">No orders pending dispatch</p>
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-secondary hover:bg-secondary">
                    <TableHead className="w-10"><Checkbox checked={paginated.length > 0 && selected.size === paginated.length} onCheckedChange={toggleAll} /></TableHead>
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
                  {paginated.map((order) => (
                    <TableRow key={order.id} className={selected.has(order.id) ? "bg-primary/5" : ""}>
                      <TableCell><Checkbox checked={selected.has(order.id)} onCheckedChange={() => toggleSelect(order.id)} /></TableCell>
                      <TableCell className="font-medium text-foreground">#{order.order_number}</TableCell>
                      <TableCell>
                        <div className="text-foreground">{order.customers?.name || "—"}</div>
                        <div className="text-xs text-muted-foreground">{order.customers?.phone || ""}</div>
                      </TableCell>
                      <TableCell><div className="text-sm text-muted-foreground max-w-[200px] truncate">{order.customers?.address || "—"}</div></TableCell>
                      <TableCell className="text-muted-foreground">{order.stores?.name || "—"}</TableCell>
                      <TableCell>{order.itemCount}</TableCell>
                      <TableCell className="text-right font-medium">৳{Number(order.total).toLocaleString()}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => openDispatch([order.id])} title="Dispatch"><Send className="h-4 w-4" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <Pagination page={page} totalPages={totalPages} filtered={filtered} setPage={setPage} />
        </TabsContent>

        {/* ── In Transit Tab ── */}
        <TabsContent value="in-transit" className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search order, customer..." className="pl-9" />
            </div>
            <Select value={storeFilter} onValueChange={setStoreFilter}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Store" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stores</SelectItem>
                {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {paginated.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card py-16">
              <Package className="h-10 w-10 text-muted-foreground" />
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
                  {paginated.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">#{order.order_number}</TableCell>
                      <TableCell>
                        <div className="text-foreground">{order.customers?.name || "—"}</div>
                        <div className="text-xs text-muted-foreground">{order.customers?.phone || ""}</div>
                      </TableCell>
                      <TableCell>
                        {order.consignment_id ? (
                          <a href={`https://merchant.pathao.com/tracking?consignment_id=${order.consignment_id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                            {order.consignment_id}<ExternalLink className="h-3 w-3" />
                          </a>
                        ) : "—"}
                      </TableCell>
                      <TableCell><TrackingBadge status={order.tracking_status} /></TableCell>
                      <TableCell><FulfillmentBadge status={order.status} /></TableCell>
                      <TableCell className="text-right font-medium">৳{Number(order.amount_to_collect || order.total).toLocaleString()}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => order.consignment_id && handleTrackOne(order.consignment_id)} title="Refresh tracking">
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <Pagination page={page} totalPages={totalPages} filtered={filtered} setPage={setPage} />
        </TabsContent>
      </Tabs>

      <OrderDetailSheet
        orderId={detailOrderId}
        open={!!detailOrderId}
        onOpenChange={(open) => { if (!open) setDetailOrderId(null); }}
        onSaved={loadOrders}
      />

      <DispatchDialog
        open={dispatchDialogOpen}
        onOpenChange={setDispatchDialogOpen}
        orders={dispatchOrders}
        onDispatched={() => { setSelected(new Set()); loadOrders(); }}
      />
    </div>
  );
};

/* ─── Pagination ─── */
function Pagination({ page, totalPages, filtered, setPage }: { page: number; totalPages: number; filtered: any[]; setPage: (p: number) => void }) {
  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground">
      <span>Showing {filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
        {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
          let pageNum: number;
          if (totalPages <= 5) pageNum = i + 1;
          else if (page <= 3) pageNum = i + 1;
          else if (page >= totalPages - 2) pageNum = totalPages - 4 + i;
          else pageNum = page - 2 + i;
          return (
            <Button key={pageNum} variant={page === pageNum ? "default" : "outline"} size="sm" className="w-9" onClick={() => setPage(pageNum)}>{pageNum}</Button>
          );
        })}
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

export default Orders;
