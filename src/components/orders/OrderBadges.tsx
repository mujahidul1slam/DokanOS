import { Badge } from "@/components/ui/badge";
import { ShoppingBag, Package, Truck } from "lucide-react";

export function DeliveryBadge({ type }: { type: string }) {
  switch (type) {
    case "delivery":
      return <Badge className="bg-cyan-500/15 text-cyan-400 border-cyan-500/20 hover:bg-cyan-500/25 gap-1"><Truck className="h-3 w-3" />Delivery</Badge>;
    case "pickup":
      return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20 hover:bg-amber-500/25 gap-1"><Package className="h-3 w-3" />Pickup</Badge>;
    default:
      return <Badge className="bg-zinc-500/15 text-zinc-400 border-zinc-500/20 hover:bg-zinc-500/25 gap-1"><ShoppingBag className="h-3 w-3" />Walk-in</Badge>;
  }
}

export function SourceBadge({ source, storeName }: { source: string; storeName?: string | null }) {
  if (source === "pos") {
    return <Badge className="bg-purple-500/15 text-purple-400 border-purple-500/20 hover:bg-purple-500/25">POS</Badge>;
  }
  if (source === "online" || source === "woo" || source === "woocommerce") {
    return (
      <Badge className="bg-primary/15 text-primary border-primary/20 hover:bg-primary/25">
        WooCommerce{storeName ? ` [${storeName}]` : ""}
      </Badge>
    );
  }
  // Manual orders (phone, fb/ig, whatsapp, etc.) — show the source label directly
  const label = source ? source.charAt(0).toUpperCase() + source.slice(1) : "Manual";
  return (
    <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/20 hover:bg-blue-500/25">
      {label}
    </Badge>
  );
}

export function PaymentBadge({ status }: { status: string }) {
  switch (status) {
    case "paid":
      return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/25">Paid</Badge>;
    case "cod":
      return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20 hover:bg-amber-500/25">COD</Badge>;
    case "online":
      return <Badge className="bg-sky-500/15 text-sky-400 border-sky-500/20 hover:bg-sky-500/25">Online</Badge>;
    case "partial":
      return <Badge className="bg-orange-500/15 text-orange-400 border-orange-500/20 hover:bg-orange-500/25">Partial</Badge>;
    case "pending_payment":
      return <Badge className="bg-yellow-500/15 text-yellow-400 border-yellow-500/20 hover:bg-yellow-500/25">Pending Payment</Badge>;
    case "refunded":
      return <Badge className="bg-zinc-500/15 text-zinc-400 border-zinc-500/20 hover:bg-zinc-500/25">Refunded</Badge>;
    default:
      return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20 hover:bg-amber-500/25">Unpaid</Badge>;
  }
}

export function FulfillmentBadge({ status }: { status: string }) {
  switch (status) {
    case "processing":
      return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20 hover:bg-amber-500/25">New Order</Badge>;
    case "payment_pending":
      return <Badge className="bg-yellow-500/15 text-yellow-400 border-yellow-500/20 hover:bg-yellow-500/25">Payment Pending</Badge>;
    case "ready_to_ship":
      return <Badge className="bg-cyan-500/15 text-cyan-400 border-cyan-500/20 hover:bg-cyan-500/25">Ready to Ship</Badge>;
    case "pre_order_pending":
      return <Badge className="bg-violet-500/15 text-violet-400 border-violet-500/20 hover:bg-violet-500/25">Pre-Order</Badge>;
    case "pre_order_making":
      return <Badge className="bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/20 hover:bg-fuchsia-500/25">Making</Badge>;
    case "pre_order_ready":
      return <Badge className="bg-teal-500/15 text-teal-400 border-teal-500/20 hover:bg-teal-500/25">Pre-Order Ready</Badge>;
    case "shipped":
      return <Badge className="bg-primary/15 text-primary border-primary/20 hover:bg-primary/25">Shipped</Badge>;
    case "delivered":
      return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/25">Delivered</Badge>;
    case "returned":
      return <Badge className="bg-zinc-500/15 text-zinc-400 border-zinc-500/20 hover:bg-zinc-500/25">Returned</Badge>;
    case "cancelled":
      return <Badge className="bg-red-500/15 text-red-400 border-red-500/20 hover:bg-red-500/25">Cancelled</Badge>;
    default:
      return <Badge className="bg-zinc-500/15 text-zinc-400 border-zinc-500/20 hover:bg-zinc-500/25">{status}</Badge>;
  }
}

export function TrackingBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;

  const colorMap: Record<string, string> = {
    "Pending": "bg-amber-500/15 text-amber-400 border-amber-500/20",
    "Pickup Pending": "bg-amber-500/15 text-amber-400 border-amber-500/20",
    "Assigned for Pickup": "bg-primary/15 text-primary border-primary/20",
    "Picked": "bg-primary/15 text-primary border-primary/20",
    "Picked Up": "bg-primary/15 text-primary border-primary/20",
    "At Sorting Hub": "bg-primary/15 text-primary border-primary/20",
    "In Transit": "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
    "Out for Delivery": "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
    "Delivered": "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
    "Partial Delivered": "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
    "Payment Invoice": "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
    "Return": "bg-red-500/15 text-red-400 border-red-500/20",
    "Returned": "bg-red-500/15 text-red-400 border-red-500/20",
    "Paid Return": "bg-red-500/15 text-red-400 border-red-500/20",
    "Return Requested": "bg-red-500/15 text-red-400 border-red-500/20",
    "Return In Transit": "bg-red-500/15 text-red-400 border-red-500/20",
    "Returned to Merchant": "bg-red-500/15 text-red-400 border-red-500/20",
    "Merchant Return": "bg-red-500/15 text-red-400 border-red-500/20",
    "Return Delivered": "bg-red-500/15 text-red-400 border-red-500/20",
    "Delivery Failed": "bg-red-500/15 text-red-400 border-red-500/20",
    "Customer Refused": "bg-red-500/15 text-red-400 border-red-500/20",
    "Exchange": "bg-orange-500/15 text-orange-400 border-orange-500/20",
    "On Hold": "bg-amber-500/15 text-amber-400 border-amber-500/20",
    "Pickup Cancel": "bg-red-500/15 text-red-400 border-red-500/20",
    "Pickup Failed": "bg-red-500/15 text-red-400 border-red-500/20",
    "Cancelled": "bg-zinc-500/15 text-zinc-400 border-zinc-500/20",
  };

  return (
    <Badge className={colorMap[status] || "bg-muted text-muted-foreground"}>
      {status}
    </Badge>
  );
}
