import { memo } from "react";
import {
  ShoppingCart, Package, Hourglass, PackageCheck, Clock, Truck, CheckCircle2,
  AlertTriangle, Undo2, XCircle, Trash2, Wrench, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TabKey } from "@/pages/orders/tabFilters";

export interface TabCounts {
  all: number;
  new: number;
  pre_order: number;
  ready: number;
  pickup_pending: number;
  in_transit: number;
  delivered: number;
  on_hold: number;
  returned: number;
  cancelled: number;
  trash: number;
  pre_order_pending: number;
  pre_order_making: number;
  pre_order_ready: number;
}

interface OrderTabsProps {
  tab: TabKey;
  onChange: (tab: TabKey) => void;
  counts: TabCounts;
}

interface TabItem {
  key: TabKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  count: number;
}

function OrderTabsImpl({ tab, onChange, counts }: OrderTabsProps) {
  const tabItems: TabItem[] = [
    { key: "all", label: "All", icon: ShoppingCart, count: counts.all },
    { key: "new", label: "New", icon: Package, count: counts.new },
    { key: "pre_order", label: "Pre-Order", icon: Hourglass, count: counts.pre_order },
    { key: "ready", label: "Ready", icon: PackageCheck, count: counts.ready },
    { key: "pickup_pending", label: "Pickup", icon: Clock, count: counts.pickup_pending },
    { key: "in_transit", label: "Transit", icon: Truck, count: counts.in_transit },
    { key: "delivered", label: "Delivered", icon: CheckCircle2, count: counts.delivered },
    { key: "on_hold", label: "On Hold", icon: AlertTriangle, count: counts.on_hold },
    { key: "returned", label: "Returned", icon: Undo2, count: counts.returned },
    { key: "cancelled", label: "Cancelled", icon: XCircle, count: counts.cancelled },
    ...(counts.trash > 0 ? [{ key: "trash" as TabKey, label: "Trash", icon: Trash2, count: counts.trash }] : []),
  ];

  return (
    <div className="flex flex-wrap gap-2 pb-1">
      {tabItems.map((t) => {
        const active = tab === t.key;
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={cn(
              "shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-foreground border-border hover:bg-accent"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {t.label}
            <span className={cn(
              "ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] leading-none",
              active ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground"
            )}>{t.count}</span>
          </button>
        );
      })}
    </div>
  );
}

export default memo(OrderTabsImpl);
