import { useEffect, useState, useMemo, useCallback } from "react";
import { format } from "date-fns";
import {
  Search, Users, ChevronRight, Phone, Mail, MapPin, ShoppingCart, X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { FulfillmentBadge, PaymentBadge, SourceBadge } from "@/components/orders/OrderBadges";

interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  zone: string | null;
  area: string | null;
  store_id: string | null;
  created_at: string;
  order_count: number;
  total_spent: number;
}

interface CustomerOrder {
  id: string;
  order_number: string;
  total: number;
  status: string;
  source: string;
  payment_status: string;
  created_at: string;
}

interface StoreOption { id: string; name: string }

const PAGE_SIZE = 15;

const Customers = () => {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [storeFilter, setStoreFilter] = useState("all");
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [page, setPage] = useState(1);

  // Detail sheet
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null);
  const [customerOrders, setCustomerOrders] = useState<CustomerOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  const loadCustomers = useCallback(async () => {
    const { data } = await supabase
      .from("customers")
      .select("id, name, phone, email, address, city, zone, area, store_id, created_at")
      .order("created_at", { ascending: false });

    if (!data) { setLoading(false); return; }

    // Fetch order stats per customer
    const { data: stats } = await supabase
      .from("orders")
      .select("customer_id, total");

    const statsMap: Record<string, { count: number; spent: number }> = {};
    (stats || []).forEach((o: any) => {
      if (!o.customer_id) return;
      if (!statsMap[o.customer_id]) statsMap[o.customer_id] = { count: 0, spent: 0 };
      statsMap[o.customer_id].count++;
      statsMap[o.customer_id].spent += Number(o.total || 0);
    });

    setCustomers(data.map((c: any) => ({
      ...c,
      order_count: statsMap[c.id]?.count || 0,
      total_spent: statsMap[c.id]?.spent || 0,
    })));
    setLoading(false);
  }, []);

  const loadStores = useCallback(async () => {
    const { data } = await supabase.from("stores").select("id, name").order("name");
    setStores(data || []);
  }, []);

  useEffect(() => { loadCustomers(); loadStores(); }, [loadCustomers, loadStores]);

  const openCustomerDetail = async (customer: CustomerRow) => {
    setSelectedCustomer(customer);
    setOrdersLoading(true);
    const { data } = await supabase
      .from("orders")
      .select("id, order_number, total, status, source, payment_status, created_at")
      .eq("customer_id", customer.id)
      .order("created_at", { ascending: false });
    setCustomerOrders((data || []) as CustomerOrder[]);
    setOrdersLoading(false);
  };

  const filtered = useMemo(() => {
    return customers.filter((c) => {
      const q = search.toLowerCase();
      const matchSearch = !q ||
        c.name.toLowerCase().includes(q) ||
        (c.phone || "").toLowerCase().includes(q) ||
        (c.email || "").toLowerCase().includes(q);
      const matchStore = storeFilter === "all" || c.store_id === storeFilter;
      return matchSearch && matchStore;
    });
  }, [customers, search, storeFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [search, storeFilter]);

  if (loading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="font-heading text-2xl font-semibold">Customers</h1>
        <p className="text-sm text-muted-foreground">{customers.length} customers across all channels</p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone, or email..." className="pl-9" />
        </div>
        <Select value={storeFilter} onValueChange={setStoreFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Store" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stores</SelectItem>
            {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-secondary hover:bg-secondary">
              <TableHead>Customer</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Location</TableHead>
              <TableHead className="text-center">Orders</TableHead>
              <TableHead className="text-right">Total Spent</TableHead>
              <TableHead>Since</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginated.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                  <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  No customers found
                </TableCell>
              </TableRow>
            ) : paginated.map((customer) => (
              <TableRow
                key={customer.id}
                className="group cursor-pointer hover:bg-muted/50"
                onClick={() => openCustomerDetail(customer)}
              >
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                      {customer.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="font-medium text-foreground">{customer.name}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="space-y-0.5">
                    {customer.phone && (
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Phone className="h-3 w-3" />{customer.phone}
                      </div>
                    )}
                    {customer.email && (
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Mail className="h-3 w-3" />{customer.email}
                      </div>
                    )}
                    {!customer.phone && !customer.email && <span className="text-sm text-muted-foreground">—</span>}
                  </div>
                </TableCell>
                <TableCell>
                  {customer.city || customer.area ? (
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      {[customer.area, customer.zone, customer.city].filter(Boolean).join(", ")}
                    </div>
                  ) : <span className="text-sm text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-center">
                  {customer.order_count > 0 ? (
                    <Badge variant="outline" className="gap-1">
                      <ShoppingCart className="h-3 w-3" />{customer.order_count}
                    </Badge>
                  ) : <span className="text-sm text-muted-foreground">0</span>}
                </TableCell>
                <TableCell className="text-right font-medium text-foreground">
                  ৳{customer.total_spent.toLocaleString()}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {format(new Date(customer.created_at), "MMM d, yyyy")}
                </TableCell>
                <TableCell>
                  <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
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
            return <Button key={pageNum} variant={page === pageNum ? "default" : "outline"} size="sm" className="w-9" onClick={() => setPage(pageNum)}>{pageNum}</Button>;
          })}
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      </div>

      {/* Customer Detail Sheet */}
      <Sheet open={!!selectedCustomer} onOpenChange={(open) => { if (!open) setSelectedCustomer(null); }}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          {selectedCustomer && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">
                    {selectedCustomer.name.charAt(0).toUpperCase()}
                  </div>
                  {selectedCustomer.name}
                </SheetTitle>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                {/* Contact Info */}
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-foreground">Contact Information</h3>
                  <div className="grid grid-cols-1 gap-2 text-sm">
                    {selectedCustomer.phone && (
                      <div className="flex items-center gap-2 text-muted-foreground"><Phone className="h-4 w-4" />{selectedCustomer.phone}</div>
                    )}
                    {selectedCustomer.email && (
                      <div className="flex items-center gap-2 text-muted-foreground"><Mail className="h-4 w-4" />{selectedCustomer.email}</div>
                    )}
                    {selectedCustomer.address && (
                      <div className="flex items-center gap-2 text-muted-foreground"><MapPin className="h-4 w-4" />{selectedCustomer.address}</div>
                    )}
                    {(selectedCustomer.city || selectedCustomer.area) && (
                      <div className="text-muted-foreground pl-6">
                        {[selectedCustomer.area, selectedCustomer.zone, selectedCustomer.city].filter(Boolean).join(", ")}
                      </div>
                    )}
                  </div>
                </div>

                <Separator />

                {/* Stats */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg border border-border p-3 text-center">
                    <div className="text-2xl font-semibold text-foreground">{selectedCustomer.order_count}</div>
                    <div className="text-xs text-muted-foreground">Total Orders</div>
                  </div>
                  <div className="rounded-lg border border-border p-3 text-center">
                    <div className="text-2xl font-semibold text-foreground">৳{selectedCustomer.total_spent.toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground">Total Spent</div>
                  </div>
                </div>

                <Separator />

                {/* Order History */}
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-foreground">Order History</h3>
                  {ordersLoading ? (
                    <p className="text-sm text-muted-foreground">Loading orders...</p>
                  ) : customerOrders.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No orders yet</p>
                  ) : (
                    <div className="space-y-2">
                      {customerOrders.map((order) => (
                        <div key={order.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm text-foreground">#{order.order_number}</span>
                              <SourceBadge source={order.source} />
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {format(new Date(order.created_at), "MMM d, yyyy")}
                            </div>
                          </div>
                          <div className="text-right space-y-1">
                            <div className="font-medium text-sm text-foreground">৳{Number(order.total).toLocaleString()}</div>
                            <div className="flex items-center gap-1.5 justify-end">
                              <FulfillmentBadge status={order.status} />
                              <PaymentBadge status={order.payment_status} />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default Customers;
