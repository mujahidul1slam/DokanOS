import { Badge } from "@/components/ui/badge";

export function SourceBadge({ source }: { source: string }) {
  if (source === "pos") {
    return <Badge className="bg-purple-500/15 text-purple-400 border-purple-500/20 hover:bg-purple-500/25">POS</Badge>;
  }
  return <Badge className="bg-primary/15 text-primary border-primary/20 hover:bg-primary/25">WooCommerce</Badge>;
}

export function PaymentBadge({ status }: { status: string }) {
  switch (status) {
    case "paid":
      return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/25">Paid</Badge>;
    case "cod":
      return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20 hover:bg-amber-500/25">COD</Badge>;
    case "partial":
      return <Badge className="bg-orange-500/15 text-orange-400 border-orange-500/20 hover:bg-orange-500/25">Partial</Badge>;
    default:
      return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20 hover:bg-amber-500/25">Unpaid</Badge>;
  }
}

export function FulfillmentBadge({ status }: { status: string }) {
  switch (status) {
    case "processing":
      return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20 hover:bg-amber-500/25">New Order</Badge>;
    case "ready_to_ship":
      return <Badge className="bg-cyan-500/15 text-cyan-400 border-cyan-500/20 hover:bg-cyan-500/25">Ready to Ship</Badge>;
    case "shipped":
      return <Badge className="bg-primary/15 text-primary border-primary/20 hover:bg-primary/25">Shipped</Badge>;
    case "delivered":
    case "completed":
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
