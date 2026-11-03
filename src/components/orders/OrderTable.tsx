import { format } from "date-fns";
import { ExternalLink, Printer } from "lucide-react";
import { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  PaymentBadge, FulfillmentBadge, TrackingBadge, DeliveryBadge,
} from "@/components/orders/OrderBadges";
import { sourceFallbackLabel } from "@/lib/orderSources";
import { cn } from "@/lib/utils";
import type { TabKey } from "@/pages/orders/tabFilters";
import { useCurrency } from "@/hooks/useCurrency";
import { brandMonogram } from "@/lib/brandIdentity";

export interface OrderBrandPresentation {
  id: string;
  name: string;
  logo_url: string | null;
  accent: string;
}

/**
 * One merged "Brand / Source" cell: every brand attributed to the order is
 * rendered (POS orders can span brands — none may hide behind a "+N" badge),
 * with the order source shown as a muted line below the brand stack. When the
 * order has no order_sources row, the legacy text attribution (POS /
 * WooCommerce [store] / Legacy migration…) takes its place.
 */
export function BrandSourcePresentation({
  brand,
  brands,
  orderSource,
  sourceFallback,
  compact = false,
}: {
  brand: OrderBrandPresentation | null | undefined;
  /** Every brand attributed to the order's items (order_brands). POS orders can span brands. */
  brands?: OrderBrandPresentation[] | null;
  orderSource?: { name: string; type: string } | null;
  /** Label used when the order has no order_sources row. */
  sourceFallback?: string | null;
  compact?: boolean;
}) {
  // `brand` is the primary; `brands` (order_brands) already leads with it, so
  // dedupe by id and render all of them.
  const seen = new Set<string>();
  const all: OrderBrandPresentation[] = [];
  for (const b of brands ?? (brand ? [brand] : [])) {
    if (b && !seen.has(b.id)) {
      seen.add(b.id);
      all.push(b);
    }
  }
  const sourceLine = orderSource ? orderSource.name : sourceFallback || "";
  return (
    <span className={cn("inline-flex min-w-0 flex-col items-start gap-1", compact && "gap-0.5")}>
      {all.map((b) => (
        <span key={b.id} className={cn("inline-flex max-w-full min-w-0 items-center gap-2", compact && "gap-1.5")}>
          {b.logo_url ? (
            <img
              src={b.logo_url}
              alt=""
              referrerPolicy="no-referrer"
              className={cn("shrink-0 rounded object-cover", compact ? "h-5 w-5" : "h-6 w-6")}
              style={{ border: `2px solid ${b.accent}` }}
              onError={(event) => { event.currentTarget.style.display = "none"; }}
            />
          ) : (
            <span
              aria-hidden="true"
              className={cn("inline-flex shrink-0 items-center justify-center rounded font-bold text-white", compact ? "h-5 w-5 text-[9px]" : "h-6 w-6 text-[10px]")}
              style={{ backgroundColor: b.accent }}
            >
              {brandMonogram(b.name)}
            </span>
          )}
          <span className="min-w-0 truncate text-sm font-medium text-foreground">{b.name}</span>
        </span>
      ))}
      <span
        className="max-w-full truncate text-[11px] text-muted-foreground"
        title={orderSource ? `Order source · ${orderSource.type}` : undefined}
      >
        {sourceLine || "—"}
      </span>
    </span>
  );
}

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
  brand?: OrderBrandPresentation | null;
  /** All brands attributed to the order's items — POS orders can span brands. */
  brands?: OrderBrandPresentation[] | null;
  order_source?: { name: string; type: string } | null;
  productItems: { name: string; qty: number }[];
}

interface Props<T extends OrderRowLike> {
  orders: T[];
  selected: Set<string>;
  tab: TabKey;
  onToggleSelect: (id: string) => void;
  onToggleAll: () => void;
  renderActions: (order: T) => ReactNode;
  duplicateOrderIds?: ReadonlySet<string>;
}

function ProductsList({ items }: { items: { name: string; qty: number }[] }) {
  if (items.length === 0) return <span className="text-xs text-muted-foreground italic">—</span>;
  return (
    <div className="max-w-[240px]">
      <div className="space-y-0.5">
        {items.slice(0, 3).map((p, i) => (
          <div key={i} className="text-xs leading-4 break-words whitespace-normal">
            <span className="text-muted-foreground">×{p.qty}</span>{" "}<span>{p.name}</span>
          </div>
        ))}
        {items.length > 3 && (
          <Popover>
            <PopoverTrigger asChild>
              <button className="text-[11px] text-primary hover:underline cursor-pointer">+{items.length - 3} more</button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-3" align="start">
              <p className="text-xs font-medium text-muted-foreground mb-2">All items ({items.length})</p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {items.map((p, i) => (
                  <div key={i} className="text-xs leading-4"><span className="text-muted-foreground">×{p.qty}</span>{" "}<span>{p.name}</span></div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}

function OrderTable<T extends OrderRowLike>({
  orders, selected, tab, onToggleSelect, onToggleAll, renderActions, duplicateOrderIds,
}: Props<T>) {
  const { symbol } = useCurrency();
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
            <TableHead>Brand / Source</TableHead>
            <TableHead className="w-[240px]">Products</TableHead>
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
              className={cn("virtual-row-tall group", selected.has(order.id) && "bg-primary/5")}
            >
              <TableCell>
                <Checkbox
                  checked={selected.has(order.id)}
                  onCheckedChange={() => onToggleSelect(order.id)}
                />
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1.5">
                  <div className="font-medium text-foreground">#{order.order_number}</div>
                  {duplicateOrderIds?.has(order.id) && (
                    <Badge variant="destructive" className="px-1.5 py-0 text-[9px]">Duplicate</Badge>
                  )}
                </div>
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
                <BrandSourcePresentation
                  brand={order.brand}
                  brands={order.brands}
                  orderSource={order.order_source}
                  sourceFallback={sourceFallbackLabel(order.source, order.stores?.name)}
                />
              </TableCell>
              <TableCell>
                <ProductsList items={order.productItems} />
              </TableCell>
              <TableCell className="text-right">
                <div className="font-medium text-foreground">{symbol}{Number(order.total).toLocaleString()}</div>
                {order.payment_status !== "paid" && (order.amount_to_collect ?? 0) > 0 && (
                  <div className="text-xs text-amber-400">Due: {symbol}{Number(order.amount_to_collect).toLocaleString()}</div>
                )}
                <div className="mt-0.5 flex flex-col items-end gap-0.5">
                  <PaymentBadge status={order.payment_status} source={order.source} paymentMethod={order.payment_method} />
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
              <TableCell className="text-right">
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
