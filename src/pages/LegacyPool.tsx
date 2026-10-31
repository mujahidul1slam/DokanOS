import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import { useCurrency } from "@/hooks/useCurrency";
import ReassignToBrandDialog, {
  type ReassignBrandOption,
} from "@/components/legacy-pool/ReassignToBrandDialog";
import {
  AlreadyReassignedError,
  fetchOrderSourcesByBrand,
  fetchPoolCounts,
  fetchPoolCustomers,
  fetchPoolOrders,
  reassignCustomerToBrand,
  reassignOrderToBrand,
  type PoolCounts,
  type PoolCustomerRow,
  type PoolOrderRow,
  type ReassignTarget,
  type SourceLite,
} from "@/lib/legacyPool";

type PoolTab = "all" | "orders" | "customers";

interface ReassignRequest {
  kind: "order" | "customer";
  label: string;
  run: (target: ReassignTarget) => Promise<void>;
}

/**
 * Task 15 — the business-level "Legacy / unattributed" pool (spec §7): orders
 * and customers the cutover migration tagged `legacy migration` and left
 * unattributed. Staff drains the pool by reassigning rows to a brand; the
 * provenance stays `legacy`. Renders empty (not broken) both before the
 * cutover migration and after the pool is drained.
 */
export default function LegacyPool() {
  const { active, brands, myRole, contextReady } = useBusinessContext();
  const { fmt } = useCurrency();

  const [counts, setCounts] = useState<PoolCounts>({ orders: 0, customers: 0 });
  const [orders, setOrders] = useState<PoolOrderRow[]>([]);
  const [customers, setCustomers] = useState<PoolCustomerRow[]>([]);
  const [sourcesByBrand, setSourcesByBrand] = useState<
    Record<string, SourceLite[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<PoolTab>("all");
  const [search, setSearch] = useState("");
  const [includeDeleted, setIncludeDeleted] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [reassign, setReassign] = useState<ReassignRequest | null>(null);

  const canReassign = useMemo(
    () => ["owner", "admin", "manager"].includes(myRole ?? ""),
    [myRole],
  );

  const brandOptions: ReassignBrandOption[] = useMemo(
    () =>
      brands.map((b) => ({
        id: b.id,
        name: b.name,
        woo_store_id: b.woo_store_id,
      })),
    [brands],
  );

  const load = useCallback(async () => {
    if (!active || !contextReady) {
      setOrders([]);
      setCustomers([]);
      setCounts({ orders: 0, customers: 0 });
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const [nextCounts, nextOrders, nextCustomers, nextSources] =
        await Promise.all([
          fetchPoolCounts(),
          fetchPoolOrders({ search, includeDeleted }),
          fetchPoolCustomers({ search }),
          fetchOrderSourcesByBrand(brands.map((b) => b.id)),
        ]);
      setCounts(nextCounts);
      setOrders(nextOrders);
      setCustomers(nextCustomers);
      setSourcesByBrand(nextSources);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load the pool.");
    } finally {
      setLoading(false);
    }
  }, [active, contextReady, search, includeDeleted, brands]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const refresh = useCallback(() => setReloadKey((key) => key + 1), []);

  const openReassignOrder = (row: PoolOrderRow) =>
    setReassign({
      kind: "order",
      label: `Order #${row.order_number ?? row.id.slice(0, 8)}`,
      run: (target) => reassignOrderToBrand(row.id, target),
    });

  const openReassignCustomer = (row: PoolCustomerRow) =>
    setReassign({
      kind: "customer",
      label: row.name || row.phone || "this customer",
      run: (target) => reassignCustomerToBrand(row.id, target),
    });

  const confirmReassign = async (target: ReassignTarget) => {
    if (!reassign) return;
    try {
      await reassign.run(target);
      toast.success(`${reassign.label} moved to ${target.brand.name}.`);
      setReassign(null);
      refresh();
    } catch (err) {
      if (err instanceof AlreadyReassignedError) {
        toast.info(err.message);
        setReassign(null);
        refresh();
        return;
      }
      throw err instanceof Error
        ? err
        : new Error("Reassignment failed.");
    }
  };

  const showOrders = tab !== "customers";
  const showCustomers = tab !== "orders";
  const total = counts.orders + counts.customers;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Legacy / unattributed
          </h1>
          <p className="text-muted-foreground">
            Orders and customers the cutover migration could not attribute to a
            brand. Reassign them to a brand to bring them into brand-level
            reports — their provenance stays{" "}
            <span className="font-medium">legacy</span>.
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant="secondary">{counts.orders} orders</Badge>
          <Badge variant="secondary">{counts.customers} customers</Badge>
        </div>
      </header>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 py-4">
          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as PoolTab)}
          >
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="orders">Orders</TabsTrigger>
              <TabsTrigger value="customers">Customers</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="grid gap-1.5">
            <Label htmlFor="legacy-pool-search">Search</Label>
            <Input
              id="legacy-pool-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Order number, name or phone"
              className="w-64"
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="legacy-pool-deleted"
              checked={includeDeleted}
              onCheckedChange={setIncludeDeleted}
            />
            <Label htmlFor="legacy-pool-deleted">Include deleted orders</Label>
          </div>
        </CardContent>
      </Card>

      {loadError && (
        <Card className="border-destructive/50">
          <CardContent className="py-4 text-sm text-destructive">
            {loadError}
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : total === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-lg font-medium">The legacy pool is empty</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Nothing is waiting for attribution. Rows tagged{" "}
              <code>legacy migration</code> by the cutover migration appear
              here until they are reassigned to a brand.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {showOrders && (
            <Card>
              <CardHeader>
                <CardTitle>Orders ({counts.orders})</CardTitle>
              </CardHeader>
              <CardContent>
                {orders.length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">
                    No pool orders match this filter.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Order</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Total</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orders.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium">
                            #{row.order_number ?? row.id.slice(0, 8)}
                            {row.deleted_at && (
                              <Badge
                                variant="outline"
                                className="ml-2 text-muted-foreground"
                              >
                                deleted
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>{row.customer_name ?? "—"}</TableCell>
                          <TableCell>{row.customer_phone ?? "—"}</TableCell>
                          <TableCell>
                            {row.total == null ? "—" : fmt(row.total)}
                          </TableCell>
                          <TableCell>{row.status ?? "—"}</TableCell>
                          <TableCell>
                            {row.created_at
                              ? new Date(row.created_at).toLocaleDateString()
                              : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {canReassign && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openReassignOrder(row)}
                              >
                                Reassign
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}

          {showCustomers && (
            <Card>
              <CardHeader>
                <CardTitle>Customers ({counts.customers})</CardTitle>
              </CardHeader>
              <CardContent>
                {customers.length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">
                    No pool customers match this filter.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>City</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {customers.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium">
                            {row.name ?? "—"}
                          </TableCell>
                          <TableCell>{row.phone ?? "—"}</TableCell>
                          <TableCell>{row.email ?? "—"}</TableCell>
                          <TableCell>{row.city ?? "—"}</TableCell>
                          <TableCell>
                            {row.created_at
                              ? new Date(row.created_at).toLocaleDateString()
                              : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {canReassign && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openReassignCustomer(row)}
                              >
                                Reassign
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <ReassignToBrandDialog
        open={reassign !== null}
        onOpenChange={(open) => {
          if (!open) setReassign(null);
        }}
        itemLabel={reassign?.label ?? ""}
        brands={brandOptions}
        sourcesByBrand={sourcesByBrand}
        onConfirm={confirmReassign}
      />
    </div>
  );
}
