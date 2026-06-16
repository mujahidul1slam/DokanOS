import { format } from "date-fns";
import { ExternalLink, Printer } from "lucide-react";
import { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  SourceBadge, PaymentBadge, FulfillmentBadge, TrackingBadge, DeliveryBadge,
} from "@/components/orders/OrderBadges";
import { cn } from "@/lib/utils";
import type { TabKey } from "@/pages/orders/tabFilters";

interface OrderRowLike {
  id: string;
  order_number: string;
  total: number;
  status: string;
  source: string;
  payment_method: string | null;
  payment_status: string;
  consignment_id: string | null;
  tracking_status: string | null;
  fulfillment_type: string;
  created_at: string;
  amount_to_collect: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  pickup_slip_printed_at?: string | null;
  measurement_slip_printed_at?: string | null;
  stores: { name: string } | null;
  productItems: { name: string; qty: number }[];
}

interface Props<T extends OrderRowLike> {
  orders: T[];
  selected: Set<string>;
  tab: TabKey;
  onToggleSelect: (id: string) => void;
  onToggleAll: () => void;
  onOpen: (id: string) => void;
  renderActions: (order: T) => ReactNode;
}

function ProductsList({ items }: { items: { name: string; qty: number }[] }) {
  if (items.length === 0) return <span className="text-xs text-muted-foreground italic">—</span>;
  const first = items[0];
  const more = items.length - 1;
  return (
    <div className="text-sm">
      <div className="truncate max-w-[220px] text-foreground">
        {first.name}{first.qty > 1 ? ` ×${first.qty}` : ""}
      </div>
      {more > 0 && <div className="text-xs text-muted-foreground">+{more} more</div>}
    </div>
  );
}

function OrderTable<T extends OrderRowLike>({
  orders, selected, tab, onToggleSelect, onToggleAll, onOpen, renderActions,
}: Props<T>) {
  const allChecked = orders.length > 0 && orders.every((o) => selected.has(o.id));
  return (
    <div className="hidden xl:block rounded-lg border border-border overflow-hidden mt-4">
      <Table>
        <TableHeader>
          <TableRow className="bg-secondary hover:bg-secondary">
            <TableHead className="w-10">
              <Checkbox checked={allChecked} onCheckedChange={onToggleAll} />
            </TableHead>
            <TableHead>Order Info</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Store</TableHead>
            <TableHead className="w-[240px]">Products</TableHead>
            <TableHead>Source</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead>Delivery</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Courier</TableHead>
            <TableHead className="text-right w-[140px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => (
            <TableRow
              key={order.id}
              className={cn("virtual-row-tall group cursor-pointer", selected.has(order.id) && "bg-primary/5")}
              onClick={() => onOpen(order.id)}
            >
              <TableCell onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={selected.has(order.id)}
                  onCheckedChange={() => onToggleSelect(order.id)}
                />
              </TableCell>
              <TableCell>
                <div className="font-medium text-foreground">#{order.order_number}</div>
                <div className="text-xs text-muted-foreground">
                  {format(new Date(order.created_at), "MMM d, yyyy · h:mm a")}
                </div>
              </TableCell>
              <TableCell>
                <div className="font-medium text-foreground">{order.customer_name || "—"}</div>
                <div className="text-xs text-muted-foreground">{order.customer_phone || "—"}</div>
                {(tab === "ready" || tab === "new") && order.customer_address && (
                  <div className="text-xs text-muted-foreground max-w-[180px] truncate mt-0.5">
                    {order.customer_address}
                  </div>
                )}
              </TableCell>
              <TableCell>
                <span className="text-sm text-foreground">
                  {order.stores?.name || (order.source === "pos" ? "POS" : "—")}
                </span>
              </TableCell>
              <TableCell>
                <ProductsList items={order.productItems} />
              </TableCell>
              <TableCell><SourceBadge source={order.source} storeName={order.stores?.name} /></TableCell>
              <TableCell className="text-right">
                <div className="font-medium text-foreground">৳{Number(order.total).toLocaleString()}</div>
                {order.payment_status !== "paid" && (order.amount_to_collect ?? 0) > 0 && (
                  <div className="text-xs text-amber-400">Due: ৳{Number(order.amount_to_collect).toLocaleString()}</div>
                )}
                <div className="mt-0.5 flex flex-col items-end gap-0.5">
                  <PaymentBadge status={order.payment_status} />
                  {order.payment_method && order.payment_status !== "cod" && (
                    <span className="text-[11px] text-muted-foreground">{order.payment_method}</span>
                  )}
                </div>
              </TableCell>
              <TableCell><DeliveryBadge type={order.fulfillment_type} /></TableCell>
              <TableCell>
                <div className="flex flex-col items-start gap-1">
                  <FulfillmentBadge status={order.status} />
                  {(order.pickup_slip_printed_at || order.measurement_slip_printed_at) && (
                    <div className="flex flex-wrap gap-1">
                      {order.pickup_slip_printed_at && (
                        <Badge
                          variant="outline"
                          className="gap-1 px-1.5 py-0 h-4 text-[9px] font-normal border-cyan-500/40 text-cyan-400"
                          title={`Pickup slip printed ${new Date(order.pickup_slip_printed_at).toLocaleString()}`}
                        >
                          <Printer className="h-2.5 w-2.5" /> Pickup
                        </Badge>
                      )}
                      {order.measurement_slip_printed_at && (
                        <Badge
                          variant="outline"
                          className="gap-1 px-1.5 py-0 h-4 text-[9px] font-normal border-violet-500/40 text-violet-400"
                          title={`Measurement slip printed ${new Date(order.measurement_slip_printed_at).toLocaleString()}`}
                        >
                          <Printer className="h-2.5 w-2.5" /> Meas.
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
              </TableCell>
              <TableCell>
                {order.consignment_id ? (
                  <div className="space-y-1">
                    <a
                      href={`https://merchant.pathao.com/tracking?consignment_id=${order.consignment_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      {order.consignment_id}<ExternalLink className="h-3 w-3" />
                    </a>
                    <div><TrackingBadge status={order.tracking_status} /></div>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground italic">—</span>
                )}
              </TableCell>
              <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                {renderActions(order)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default OrderTable;
