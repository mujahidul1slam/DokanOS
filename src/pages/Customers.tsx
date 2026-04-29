import { useEffect, useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import {
  Search, Users, ChevronRight, Phone, Mail, MapPin, ShoppingCart, Download, RefreshCw, Loader2, Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { downloadCsv } from "@/lib/exportCsv";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { FulfillmentBadge, PaymentBadge, SourceBadge } from "@/components/orders/OrderBadges";
import { TableSkeleton } from "@/components/ui/loading-states";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/useDebounce";

interface AliasRow { id?: string; type: "name" | "email" | "address"; value: string; source_store_id: string | null; }

interface UnifiedCustomer {
  id: string; // keeper customer row id
  phone: string | null;
  primaryName: string;
  primaryEmail: string | null;
  primaryAddress: string | null;
  city: string | null;
  source: string;
  created_at: string;
  store_id: string | null;
  names: AliasRow[];
  emails: AliasRow[];
  addresses: AliasRow[];
  order_count: number;
  total_spent: number;
}

interface CustomerOrder {
  id: string; order_number: string; total: number; status: string;
  source: string; payment_status: string; created_at: string;
}

interface StoreOption { id: string; name: string }

const PAGE_SIZE = 200;

const Customers = () => {
  const [customers, setCustomers] = useState<UnifiedCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [page, setPage] = useState(1);
  const [syncing, setSyncing] = useState(false);

  const [selected, setSelected] = useState<UnifiedCustomer | null>(null);
  const [customerOrders, setCustomerOrders] = useState<CustomerOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const storeName = useCallback((id: string | null) => stores.find((s) => s.id === id)?.name || "—", [stores]);

  const loadCustomers = useCallback(async () => {
    // Paginated fetch to bypass Supabase 1000-row default limit
    const fetchAll = async <T,>(table: string, columns: string): Promise<T[]> => {
      const PAGE = 1000;
      let from = 0;
      const all: T[] = [];
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await supabase.from(table as any).select(columns).range(from, from + PAGE - 1);
        if (error || !data || data.length === 0) break;
        all.push(...(data as T[]));
        if (data.length < PAGE) break;
        from += PAGE;
      }
      return all;
    };

    const [custs, aliases, stats] = await Promise.all([
      fetchAll<any>("customers", "id, name, phone, email, address, city, store_id, source, created_at"),
      fetchAll<any>("customer_aliases", "id, customer_id, type, value, source_store_id"),
      fetchAll<any>("orders", "customer_id, total"),
    ]);

    const aliasMap = new Map<string, AliasRow[]>();
    (aliases || []).forEach((a: any) => {
      if (!aliasMap.has(a.customer_id)) aliasMap.set(a.customer_id, []);
      aliasMap.get(a.customer_id)!.push({ id: a.id, type: a.type, value: a.value, source_store_id: a.source_store_id });
    });

    const statsMap: Record<string, { count: number; spent: number }> = {};
    (stats || []).forEach((o: any) => {
      if (!o.customer_id) return;
      if (!statsMap[o.customer_id]) statsMap[o.customer_id] = { count: 0, spent: 0 };
      statsMap[o.customer_id].count++;
      statsMap[o.customer_id].spent += Number(o.total || 0);
    });

    const rows: UnifiedCustomer[] = (custs || []).map((c: any) => {
      const ax = aliasMap.get(c.id) || [];
      const names = ax.filter((a) => a.type === "name");
      const emails = ax.filter((a) => a.type === "email");
      const addresses = ax.filter((a) => a.type === "address");
      return {
        id: c.id,
        phone: c.phone,
        primaryName: c.name,
        primaryEmail: c.email,
        primaryAddress: c.address,
        city: c.city,
        source: c.source,
        created_at: c.created_at,
        store_id: c.store_id,
        names, emails, addresses,
        order_count: statsMap[c.id]?.count || 0,
        total_spent: statsMap[c.id]?.spent || 0,
      };
    });
    rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    setCustomers(rows);
    setLoading(false);
  }, []);

  const loadStores = useCallback(async () => {
    const { data } = await supabase.from("stores").select("id, name").order("name");
    setStores(data || []);
  }, []);

  useEffect(() => { loadCustomers(); loadStores(); }, [loadCustomers, loadStores]);

  const handleSyncCustomers = async () => {
    setSyncing(true);
    try {
      const { data: storeRows } = await supabase.from("stores").select("id, name");
      if (!storeRows || storeRows.length === 0) {
        toast({ title: "No stores connected", variant: "destructive" });
        return;
      }
      let started = 0;
      for (const s of storeRows) {
        const { error } = await supabase.functions.invoke("woo-sync", {
          body: { store_id: s.id, sync_customers: true },
        });
        if (!error) started++;
      }
      toast({
        title: `Customer sync started for ${started} store(s)`,
        description: "Running in background. Refresh in a minute to see updates.",
      });
    } catch (err: any) {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const openDetail = async (c: UnifiedCustomer) => {
    setSelected(c);
    setOrdersLoading(true);
    const { data } = await supabase
      .from("orders")
      .select("id, order_number, total, status, source, payment_status, created_at")
      .eq("customer_id", c.id)
      .order("created_at", { ascending: false });
    setCustomerOrders((data || []) as CustomerOrder[]);
    setOrdersLoading(false);
  };

  const deleteAlias = async (alias: AliasRow) => {
    if (!alias.id || !selected) return;
    if (!confirm(`Delete this ${alias.type}?\n\n${alias.value}`)) return;
    const { error } = await supabase.from("customer_aliases").delete().eq("id", alias.id);
    if (error) {
      toast({ title: "Failed to delete", description: error.message, variant: "destructive" });
      return;
    }
    // Update local state
    setCustomers((prev) => prev.map((c) => {
      if (c.id !== selected.id) return c;
      const filterFn = (a: AliasRow) => a.id !== alias.id;
      return { ...c, names: c.names.filter(filterFn), emails: c.emails.filter(filterFn), addresses: c.addresses.filter(filterFn) };
    }));
    setSelected((prev) => {
      if (!prev) return prev;
      const filterFn = (a: AliasRow) => a.id !== alias.id;
      return { ...prev, names: prev.names.filter(filterFn), emails: prev.emails.filter(filterFn), addresses: prev.addresses.filter(filterFn) };
    });
    toast({ title: `${alias.type} deleted` });
  };

  const debouncedSearch = useDebounce(search, 200);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) =>
      c.primaryName.toLowerCase().includes(q) ||
      (c.phone || "").toLowerCase().includes(q) ||
      (c.primaryEmail || "").toLowerCase().includes(q) ||
      c.names.some((n) => n.value.toLowerCase().includes(q)) ||
      c.emails.some((e) => e.value.toLowerCase().includes(q))
    );
  }, [customers, debouncedSearch]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );

  useEffect(() => { setPage(1); }, [debouncedSearch]);

  if (loading) return (
    <div className="space-y-4">
      <div><h1 className="font-heading text-2xl font-semibold">Customers</h1></div>
      <TableSkeleton rows={8} cols={6} />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Customers</h1>
          <p className="text-sm text-muted-foreground">{customers.length} unique customers (grouped by phone)</p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={handleSyncCustomers} disabled={syncing}>
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Sync Customers
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search any name, phone, or email..." className="pl-9" />
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => {
          const headers = ["Name", "Phone", "Email", "Address", "City", "Names Count", "Emails Count", "Addresses Count", "Orders", "Total Spent", "Joined"];
          const rows = filtered.map((c) => [
            c.primaryName, c.phone || "", c.primaryEmail || "", c.primaryAddress || "", c.city || "",
            String(c.names.length), String(c.emails.length), String(c.addresses.length),
            String(c.order_count), String(c.total_spent),
            format(new Date(c.created_at), "yyyy-MM-dd"),
          ]);
          downloadCsv(`customers-${format(new Date(), "yyyy-MM-dd")}.csv`, headers, rows);
        }}>
          <Download className="h-4 w-4" /> Export
        </Button>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {paginated.length === 0 ? (
          <div className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
            <Users className="h-8 w-8 mx-auto mb-2 opacity-50" /> No customers found
          </div>
        ) : paginated.map((c) => (
          <div
            key={c.id}
            onClick={() => openDetail(c)}
            className="rounded-lg border border-border bg-card p-3 active:bg-accent/50 transition-colors"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary shrink-0">
                {c.primaryName.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-foreground truncate">{c.primaryName}</div>
                  <div className="font-semibold text-foreground whitespace-nowrap">৳{c.total_spent.toLocaleString()}</div>
                </div>
                {c.phone && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                    <Phone className="h-3 w-3" />{c.phone}
                  </div>
                )}
                {c.primaryEmail && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground truncate">
                    <Mail className="h-3 w-3" />{c.primaryEmail}
                  </div>
                )}
                {c.city && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" />{c.city}
                  </div>
                )}
                <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                  <Badge variant="outline" className="gap-1">
                    <ShoppingCart className="h-3 w-3" />{c.order_count} orders
                  </Badge>
                  <span>Since {format(new Date(c.created_at), "MMM yyyy")}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden md:block rounded-lg border border-border overflow-hidden">
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
                  <Users className="h-8 w-8 mx-auto mb-2 opacity-50" /> No customers found
                </TableCell>
              </TableRow>
            ) : paginated.map((c) => (
              <TableRow key={c.id} className="virtual-row group cursor-pointer hover:bg-muted/50" onClick={() => openDetail(c)}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                      {c.primaryName.charAt(0).toUpperCase()}
                    </div>
                    <span className="font-medium text-foreground">
                      {c.primaryName}{c.names.length > 1 && <span className="text-muted-foreground">, .....</span>}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="space-y-0.5">
                    {c.phone && (
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Phone className="h-3 w-3" />{c.phone}
                      </div>
                    )}
                    {c.primaryEmail && (
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Mail className="h-3 w-3" />{c.primaryEmail}{c.emails.length > 1 && <span>, .....</span>}
                      </div>
                    )}
                    {!c.phone && !c.primaryEmail && <span className="text-sm text-muted-foreground">—</span>}
                  </div>
                </TableCell>
                <TableCell>
                  {c.city ? (
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <MapPin className="h-3 w-3" />{c.city}
                    </div>
                  ) : <span className="text-sm text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-center">
                  {c.order_count > 0 ? (
                    <Badge variant="outline" className="gap-1">
                      <ShoppingCart className="h-3 w-3" />{c.order_count}
                    </Badge>
                  ) : <span className="text-sm text-muted-foreground">0</span>}
                </TableCell>
                <TableCell className="text-right font-medium text-foreground">
                  ৳{c.total_spent.toLocaleString()}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {format(new Date(c.created_at), "MMM d, yyyy")}
                </TableCell>
                <TableCell>
                  <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>Showing {filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null); }}>
        <SheetContent className="sm:max-w-xl overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">
                    {selected.primaryName.charAt(0).toUpperCase()}
                  </div>
                  {selected.primaryName}
                </SheetTitle>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                <div className="space-y-3">
                  <h3 className="text-sm font-medium">Phone</h3>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="h-4 w-4" />{selected.phone || "—"}
                  </div>
                </div>

                <Separator />

                {selected.names.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium">Names ({selected.names.length})</h3>
                    <div className="space-y-1.5">
                      {selected.names.map((n, i) => (
                        <div key={n.id || i} className="flex items-center justify-between text-sm gap-2">
                          <span className="text-foreground flex-1">{n.value}</span>
                          <Badge variant="outline" className="text-xs">{storeName(n.source_store_id)}</Badge>
                          {selected.names.length > 1 && n.id && (
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => deleteAlias(n)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selected.emails.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium">Emails ({selected.emails.length})</h3>
                    <div className="space-y-1.5">
                      {selected.emails.map((e, i) => (
                        <div key={e.id || i} className="flex items-center justify-between text-sm gap-2">
                          <span className="text-foreground flex-1">{e.value}</span>
                          <Badge variant="outline" className="text-xs">{storeName(e.source_store_id)}</Badge>
                          {selected.emails.length > 1 && e.id && (
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => deleteAlias(e)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selected.addresses.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium">Addresses ({selected.addresses.length})</h3>
                    <div className="space-y-1.5">
                      {selected.addresses.map((a, i) => (
                        <div key={a.id || i} className="flex items-start justify-between text-sm gap-2">
                          <span className="text-foreground flex-1">{a.value}</span>
                          <Badge variant="outline" className="text-xs shrink-0">{storeName(a.source_store_id)}</Badge>
                          {selected.addresses.length > 1 && a.id && (
                            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => deleteAlias(a)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <Separator />

                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg border border-border p-3 text-center">
                    <div className="text-2xl font-semibold">{selected.order_count}</div>
                    <div className="text-xs text-muted-foreground">Total Orders</div>
                  </div>
                  <div className="rounded-lg border border-border p-3 text-center">
                    <div className="text-2xl font-semibold">৳{selected.total_spent.toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground">Total Spent</div>
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <h3 className="text-sm font-medium">Order History</h3>
                  {ordersLoading ? <p className="text-sm text-muted-foreground">Loading...</p>
                    : customerOrders.length === 0 ? <p className="text-sm text-muted-foreground">No orders yet</p>
                    : (
                      <div className="space-y-2">
                        {customerOrders.map((o) => (
                          <div
                            key={o.id}
                            className="flex items-center justify-between rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                            onClick={() => navigate(`/orders?order=${o.id}`)}
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm">#{o.order_number}</span>
                                <SourceBadge source={o.source} />
                              </div>
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {format(new Date(o.created_at), "MMM d, yyyy")}
                              </div>
                            </div>
                            <div className="text-right space-y-1">
                              <div className="font-medium text-sm">৳{Number(o.total).toLocaleString()}</div>
                              <div className="flex items-center gap-1.5 justify-end">
                                <FulfillmentBadge status={o.status} />
                                <PaymentBadge status={o.payment_status} />
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
