import { memo, useState } from "react";
import {
  CheckSquare, Package, Hourglass, Wrench, Sparkles, PackageCheck, Truck,
  CheckCircle2, Undo2, XCircle, Loader2, Ruler, Send, RefreshCw,
  CreditCard, RotateCcw, Trash2, ChevronDown, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import PickupSlipPrint from "@/components/orders/PickupSlipPrint";
import type { TabKey } from "@/pages/orders/tabFilters";
import type { OrderRow } from "@/pages/orders/useOrdersData";

interface Props {
  selectedCount: number;
  selectedOrders: OrderRow[];
  selectedIds: string[];
  bulkUpdating: boolean;
  canWrite: boolean;
  tab: TabKey;
  onBulkStatusChange: (status: string) => void;
  onBulkPrintMeasurementSlips: () => void;
  onDispatch: () => void;
  onBulkTrack: () => void;
  onBulkMarkPaid: () => void;
  onRestore: () => void;
  onTrash: () => void;
  onClear: () => void;
  onDeselect: (id: string) => void;
}

function OrderBulkActionsBarImpl({
  selectedCount, selectedOrders, bulkUpdating, canWrite, tab,
  onBulkStatusChange, onBulkPrintMeasurementSlips, onDispatch, onBulkTrack,
  onBulkMarkPaid, onRestore, onTrash, onClear, onDeselect,
}: Props) {
  const [selectionOpen, setSelectionOpen] = useState(false);
  if (selectedCount === 0) return null;
  const preview = selectedOrders.slice(0, 3).map((o) => `#${o.order_number}`).join(", ");
  const suffix = selectedCount > 3 ? ` +${selectedCount - 3}` : "";
  return (
    <div className="relative flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
      <CheckSquare className="h-4 w-4 text-primary shrink-0" />
      <button
        type="button"
        className="inline-flex items-center gap-2 text-sm font-semibold hover:underline"
        aria-expanded={selectionOpen}
        onClick={() => setSelectionOpen((open) => !open)}
      >
        {selectedCount} selected: {preview}{suffix}
        <ChevronDown className={`h-4 w-4 transition-transform ${selectionOpen ? "rotate-180" : ""}`} />
      </button>
      {selectionOpen && (
        <div className="absolute left-4 right-4 top-full z-30 mt-2 grid max-h-72 gap-2 overflow-auto rounded-lg border bg-background p-3 shadow-xl sm:grid-cols-2">
          {selectedOrders.map((order) => (
            <div key={order.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs">
              <button type="button" className="min-w-0 text-left hover:underline" onClick={() => onDeselect(order.id)}>
                <span className="block font-semibold">#{order.order_number}</span>
                <span className="block truncate text-muted-foreground">{order.customer_name || "Unknown customer"}</span>
                <span className="block font-medium">৳{Number(order.total || 0).toLocaleString()}</span>
              </button>
              <button type="button" aria-label={`Remove ${order.order_number}`} onClick={() => onDeselect(order.id)} className="shrink-0 rounded p-1 hover:bg-muted">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <Button size="sm" variant="ghost" className="justify-self-start" onClick={onClear}>Clear all</Button>
        </div>
      )}
      <div className="flex items-center gap-2 ml-auto flex-wrap">
        {canWrite && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={bulkUpdating} className="gap-1.5">
                <Package className="h-4 w-4" /> Change Status
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => onBulkStatusChange("processing")}><Package className="h-4 w-4 mr-2" /> Processing</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onBulkStatusChange("pre_order_pending")}><Hourglass className="h-4 w-4 mr-2" /> Pre-Order</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onBulkStatusChange("pre_order_making")}><Wrench className="h-4 w-4 mr-2" /> Making</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onBulkStatusChange("pre_order_ready")}><Sparkles className="h-4 w-4 mr-2" /> Pre-Order Ready</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onBulkStatusChange("ready_to_ship")}><PackageCheck className="h-4 w-4 mr-2" /> Ready to Ship</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onBulkStatusChange("shipped")}><Truck className="h-4 w-4 mr-2" /> Shipped</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onBulkStatusChange("delivered")}><CheckCircle2 className="h-4 w-4 mr-2" /> Delivered</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onBulkStatusChange("returned")}><Undo2 className="h-4 w-4 mr-2" /> Returned</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onBulkStatusChange("cancelled")} className="text-destructive"><XCircle className="h-4 w-4 mr-2" /> Cancelled</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <PickupSlipPrint orders={selectedOrders} />
        {canWrite && (
          <Button size="sm" variant="outline" onClick={onBulkPrintMeasurementSlips} disabled={bulkUpdating} className="gap-1.5">
            {bulkUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ruler className="h-4 w-4" />}
            Print Measurement Slips
          </Button>
        )}
        {canWrite && (
          <Button size="sm" onClick={onDispatch} className="gap-1.5">
            <Send className="h-4 w-4" /> Dispatch
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onBulkTrack} disabled={bulkUpdating} className="gap-1.5">
          {bulkUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Track
        </Button>
        {canWrite && (
          <Button size="sm" variant="outline" onClick={onBulkMarkPaid} disabled={bulkUpdating} className="gap-1.5">
            {bulkUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
            Mark Paid
          </Button>
        )}
        {canWrite && tab === "trash" && (
          <Button size="sm" variant="outline" onClick={onRestore} disabled={bulkUpdating} className="gap-1.5">
            <RotateCcw className="h-4 w-4" /> Restore
          </Button>
        )}
        {canWrite && tab !== "trash" && (
          <Button size="sm" variant="outline" onClick={onTrash} disabled={bulkUpdating} className="gap-1.5 text-destructive hover:text-destructive">
            <Trash2 className="h-4 w-4" /> Trash
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onClear}>Clear</Button>
      </div>
    </div>
  );
}

export default memo(OrderBulkActionsBarImpl);
