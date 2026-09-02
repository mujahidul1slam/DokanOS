import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { logAction } from "@/lib/auditLog";
import { addOrderTimeline } from "@/lib/orderTimeline";
import { postWooOrderNote, kickSyncWorker } from "@/lib/wooNotes";
import { printMeasurementSlipsBulk } from "@/components/orders/MeasurementSlipPrint";
import { recordDuePayment } from "@/lib/dueCollection";
import type { DuePaymentResult } from "@/components/orders/DuePaymentDialog";

interface BulkOrder {
  id: string;
  order_number: string;
  total: number;
  consignment_id: string | null;
  woo_order_id: number | null;
  store_id: string | null;
}

interface Params<T extends BulkOrder> {
  orders: T[];
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  setBulkUpdating: (b: boolean) => void;
  loadOrders: () => void;
  toast: (opts: { title: string; description?: string; variant?: "default" | "destructive" }) => void;
  duePayContext: { ids: string[]; totalDue: number };
  setDuePayContext: (c: { ids: string[]; totalDue: number }) => void;
  setDuePayOpen: (b: boolean) => void;
}

export function useOrderBulkActions<T extends BulkOrder>({
  orders,
  selected,
  setSelected,
  setBulkUpdating,
  loadOrders,
  toast,
  duePayContext,
  setDuePayContext,
  setDuePayOpen,
}: Params<T>) {
  const runBulkStatus = useCallback(
    async (newStatus: string, description: string, toastTitle: string, pushWoo = true) => {
      if (selected.size === 0) return;
      setBulkUpdating(true);
      try {
        const ids = Array.from(selected);
        await supabase.from("orders").update({ status: newStatus }).in("id", ids);
        await addOrderTimeline(
          ids.map((id) => ({ order_id: id, event: "status_changed", description })),
        );
        await logAction("update", "order_status_bulk", undefined, { ids, to: newStatus });

        // The DB trigger enqueued one push per order; drain them now so the
        // Woo status flips within seconds (Issue 2: manual/bulk status changes
        // must reach WooCommerce without waiting on the throttled cron).
        void kickSyncWorker();

        toast({ title: toastTitle.replace("{n}", String(ids.length)) });
        setSelected(new Set());
        loadOrders();
      } catch {
        toast({ title: "Update failed", variant: "destructive" });
      } finally {
        setBulkUpdating(false);
      }
    },
    [selected, setBulkUpdating, setSelected, loadOrders, toast],
  );

  const handleMarkReadyToShip = useCallback(
    () => runBulkStatus("ready_to_ship", "Marked as Ready to Ship", "{n} order(s) marked Ready to Ship"),
    [runBulkStatus],
  );

  const handleBulkCancel = useCallback(
    () => runBulkStatus("cancelled", "Cancelled", "{n} order(s) cancelled", false),
    [runBulkStatus],
  );

  const handleBulkStatusChange = useCallback(
    async (newStatus: string) => {
      const label = newStatus.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      await runBulkStatus(newStatus, `Status changed to ${label}`, `{n} order(s) → ${label}`);
    },
    [runBulkStatus],
  );

  const handleBulkMarkPaid = useCallback(async () => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    const { data: pays } = await supabase
      .from("order_payments")
      .select("order_id, amount")
      .in("order_id", ids);
    const paidMap = new Map<string, number>();
    (pays || []).forEach((p: any) =>
      paidMap.set(p.order_id, (paidMap.get(p.order_id) || 0) + Number(p.amount)),
    );
    const totalDue = orders
      .filter((o) => ids.includes(o.id))
      .reduce((s, o) => s + Math.max(0, Number(o.total) - (paidMap.get(o.id) || 0)), 0);
    if (totalDue <= 0) {
      toast({ title: "Nothing due — these orders are already fully paid" });
      return;
    }
    setDuePayContext({ ids, totalDue });
    setDuePayOpen(true);
  }, [orders, selected, setDuePayContext, setDuePayOpen, toast]);

  const handleConfirmBulkDuePayment = useCallback(
    async (result: DuePaymentResult) => {
      const { ids } = duePayContext;
      setBulkUpdating(true);
      try {
        const { data: pays } = await supabase
          .from("order_payments")
          .select("order_id, amount")
          .in("order_id", ids);
        const paidMap = new Map<string, number>();
        (pays || []).forEach((p: any) =>
          paidMap.set(p.order_id, (paidMap.get(p.order_id) || 0) + Number(p.amount)),
        );
        for (const id of ids) {
          const ord = orders.find((o) => o.id === id);
          if (!ord) continue;
          const due = Math.max(0, Number(ord.total) - (paidMap.get(id) || 0));
          if (due <= 0) continue;
          await recordDuePayment({
            orderId: id,
            orderNumber: ord.order_number,
            method: result.method,
            amount: due,
            trxId: result.trxId,
            notes: result.notes || "Bulk Mark Paid",
          });
        }
        await logAction("update", "order_payment_bulk", undefined, {
          ids,
          method: result.method,
          to: "paid",
        });
        toast({ title: `${ids.length} order(s) marked Paid via ${result.method}` });
        setSelected(new Set());
        loadOrders();
      } catch {
        toast({ title: "Update failed", variant: "destructive" });
      } finally {
        setBulkUpdating(false);
      }
    },
    [duePayContext, orders, setBulkUpdating, setSelected, loadOrders, toast],
  );

  const handleTrashOrders = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      setBulkUpdating(true);
      try {
        const now = new Date().toISOString();
        await supabase.from("orders").update({ deleted_at: now } as any).in("id", ids);
        await addOrderTimeline(
          ids.map((id) => ({
            order_id: id,
            event: "trashed",
            description: "Order moved to trash",
            metadata: { skip_woo_note: true },
          })),
        );
        const wooOrders = orders.filter((o) => ids.includes(o.id) && o.woo_order_id && o.store_id);
        for (const o of wooOrders) {
          try {
            await postWooOrderNote(o.id, "[DokanOS] Order moved to trash");
            await supabase.functions.invoke("woo-push", {
              body: { action: "trash_order", order_id: o.id },
            });
          } catch {}
        }
        await logAction("delete", "order_trash_bulk", undefined, { ids });
        toast({ title: `${ids.length} order(s) moved to trash` });
        setSelected(new Set());
        loadOrders();
      } catch {
        toast({ title: "Failed to trash orders", variant: "destructive" });
      } finally {
        setBulkUpdating(false);
      }
    },
    [orders, setBulkUpdating, setSelected, loadOrders, toast],
  );

  const handleRestoreOrders = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      setBulkUpdating(true);
      try {
        await supabase.from("orders").update({ deleted_at: null } as any).in("id", ids);
        await addOrderTimeline(
          ids.map((id) => ({
            order_id: id,
            event: "restored",
            description: "Order restored from trash",
          })),
        );
        await logAction("update", "order_restore_bulk", undefined, { ids });
        toast({ title: `${ids.length} order(s) restored` });
        setSelected(new Set());
        loadOrders();
      } catch {
        toast({ title: "Failed to restore orders", variant: "destructive" });
      } finally {
        setBulkUpdating(false);
      }
    },
    [setBulkUpdating, setSelected, loadOrders, toast],
  );

  const handleBulkPrintMeasurementSlips = useCallback(async () => {
    if (selected.size === 0) return;
    setBulkUpdating(true);
    try {
      const ids = Array.from(selected);
      const { printed, skipped } = await printMeasurementSlipsBulk(ids);
      toast({
        title: `Printed ${printed} measurement slip(s)`,
        description:
          skipped > 0 ? `${skipped} order(s) skipped — no measurements recorded.` : undefined,
      });
      setSelected(new Set());
      loadOrders();
    } catch {
      toast({ title: "Print failed", variant: "destructive" });
    } finally {
      setBulkUpdating(false);
    }
  }, [selected, setBulkUpdating, setSelected, loadOrders, toast]);

  const handleBulkTrackSelected = useCallback(async () => {
    if (selected.size === 0) return;
    setBulkUpdating(true);
    try {
      const selectedWithConsignment = orders.filter(
        (o) => selected.has(o.id) && o.consignment_id,
      );
      let updated = 0;
      for (const o of selectedWithConsignment) {
        try {
          const { data } = await supabase.functions.invoke("pathao-courier", {
            body: { action: "track_order", consignment_id: o.consignment_id },
          });
          if (data?.data?.order_status) updated++;
        } catch {}
      }
      toast({
        title: `Tracking updated for ${updated} of ${selectedWithConsignment.length} order(s)`,
      });
      setSelected(new Set());
      loadOrders();
    } catch {
      toast({ title: "Tracking failed", variant: "destructive" });
    } finally {
      setBulkUpdating(false);
    }
  }, [orders, selected, setBulkUpdating, setSelected, loadOrders, toast]);

  return {
    handleMarkReadyToShip,
    handleBulkMarkPaid,
    handleConfirmBulkDuePayment,
    handleBulkCancel,
    handleBulkStatusChange,
    handleTrashOrders,
    handleRestoreOrders,
    handleBulkPrintMeasurementSlips,
    handleBulkTrackSelected,
  };
}
