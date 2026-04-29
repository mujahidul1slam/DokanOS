import { format } from "date-fns";
import { ExternalLink, MoreHorizontal } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  SourceBadge, PaymentBadge, FulfillmentBadge, TrackingBadge, DeliveryBadge,
} from "@/components/orders/OrderBadges";
import { ReactNode } from "react";

interface OrderCardProps {
  order: {
    id: string;
    order_number: string;
    total: number;
    status: string;
    source: string;
    payment_status: string;
    payment_method?: string | null;
    consignment_id: string | null;
    tracking_status: string | null;
    fulfillment_type: string;
    created_at: string;
    amount_to_collect: number | null;
    customer_name: string | null;
    customer_phone: string | null;
    customer_address: string | null;
    stores: { name: string } | null;
    productItems: { name: string; qty: number }[];
  };
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  actions?: ReactNode;
}

const OrderCard = ({ order, selected, onSelect, onOpen, actions }: OrderCardProps) => {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-3 active:bg-accent/50 transition-colors",
        selected && "border-primary bg-primary/5"
      )}
    >
      <div className="flex items-start gap-2">
        <div onClick={(e) => e.stopPropagation()} className="pt-1">
          <Checkbox checked={selected} onCheckedChange={onSelect} className="h-5 w-5" />
        </div>
        <button onClick={onOpen} className="flex-1 text-left min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold text-foreground truncate">#{order.order_number}</div>
            <div className="font-semibold text-foreground whitespace-nowrap">৳{Number(order.total).toLocaleString()}</div>
          </div>
          <div className="text-[11px] text-muted-foreground">
            {format(new Date(order.created_at), "MMM d, h:mm a")}
            {order.stores?.name ? ` · ${order.stores.name}` : order.source === "pos" ? " · POS" : ""}
          </div>

          <div className="mt-2 text-sm text-foreground truncate">{order.customer_name || "—"}</div>
          {order.customer_phone && (
            <div className="text-xs text-muted-foreground">{order.customer_phone}</div>
          )}
          {order.customer_address && (
            <div className="text-xs text-muted-foreground truncate">{order.customer_address}</div>
          )}

          {order.productItems.length > 0 && (
            <div className="mt-2 text-xs text-muted-foreground line-clamp-2">
              {order.productItems.map((p) => `${p.name}${p.qty > 1 ? ` ×${p.qty}` : ""}`).join(", ")}
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <SourceBadge source={order.source} storeName={order.stores?.name} />
            <FulfillmentBadge status={order.status} />
            <DeliveryBadge type={order.fulfillment_type} />
            <PaymentBadge status={order.payment_status} />
            {order.payment_method && order.payment_status !== "cod" && (
              <span className="text-[11px] text-muted-foreground">{order.payment_method}</span>
            )}
            {order.consignment_id && <TrackingBadge status={order.tracking_status} />}
          </div>

          {order.payment_status !== "paid" && (order.amount_to_collect ?? 0) > 0 && (
            <div className="mt-1 text-xs text-amber-500">Due: ৳{Number(order.amount_to_collect).toLocaleString()}</div>
          )}

          {order.consignment_id && (
            <a
              href={`https://merchant.pathao.com/tracking?consignment_id=${order.consignment_id}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              {order.consignment_id}<ExternalLink className="h-3 w-3" />
            </a>
          )}
        </button>
        {actions && (
          <div onClick={(e) => e.stopPropagation()} className="-mr-1">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
};

export default OrderCard;
