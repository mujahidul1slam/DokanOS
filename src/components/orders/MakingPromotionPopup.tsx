import { useEffect, useState } from "react";
import { Check, ClipboardList, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useMakingPromotion,
  removeMakingCandidates,
  dismissMakingPromotion,
} from "@/lib/makingPromotionStore";
import { applyMakingPromotion } from "./MeasurementSlipPrint";
import { toast } from "sonner";

/**
 * Persistent, non-modal prompt that appears after measurement slips are
 * printed and asks the operator to move those orders into "making".
 *
 * Behavior (per request):
 *  - Does NOT auto-apply the status change — it only asks.
 *  - Stays open until explicitly dismissed.
 *  - Accumulates newly printed orders while it is open.
 */
export function MakingPromotionPopup() {
  const { open, pending } = useMakingPromotion();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  // Every newly-queued order starts checked. Keep the selection map in sync
  // with the pending list without clobbering existing choices.
  useEffect(() => {
    setSelected((prev) => {
      const next: Record<string, boolean> = { ...prev };
      for (const c of pending) {
        if (!(c.orderId in next)) next[c.orderId] = true;
      }
      // Drop ids no longer pending.
      for (const id of Object.keys(next)) {
        if (!pending.some((c) => c.orderId === id)) delete next[id];
      }
      return next;
    });
  }, [pending]);

  if (!open) return null;

  const selectedIds = pending.filter((c) => selected[c.orderId]).map((c) => c.orderId);
  const allSelected = pending.length > 0 && selectedIds.length === pending.length;

  const toggle = (id: string, value: boolean) =>
    setSelected((prev) => ({ ...prev, [id]: value }));

  const toggleAll = (value: boolean) =>
    setSelected(() => {
      const next: Record<string, boolean> = {};
      for (const c of pending) next[c.orderId] = value;
      return next;
    });

  const handleConfirm = async () => {
    if (selectedIds.length === 0) return;
    setBusy(true);
    const promotedIds: string[] = [];
    for (const id of selectedIds) {
      const cand = pending.find((c) => c.orderId === id);
      if (!cand) continue;
      const done = await applyMakingPromotion(id, cand.fromLabel, cand.fromStatus);
      if (done) promotedIds.push(id);
    }
    setBusy(false);
    if (promotedIds.length > 0) {
      removeMakingCandidates(promotedIds);
      toast.success(`${promotedIds.length} order${promotedIds.length === 1 ? "" : "s"} moved to Making`);
      // Ask the orders list to refetch so the status change is reflected.
      window.dispatchEvent(new CustomEvent("orders:refresh"));
    }
    if (promotedIds.length < selectedIds.length) {
      const failed = selectedIds.length - promotedIds.length;
      toast.error(`${failed} order${failed === 1 ? "" : "s"} could not be moved`);
    }
  };

  const handleDismiss = () => {
    dismissMakingPromotion();
  };

  return (
    <div
      role="dialog"
      aria-label="Move orders to making"
      className="fixed bottom-4 right-4 z-[60] w-[360px] rounded-lg border bg-background shadow-xl"
    >
      <div className="flex items-start gap-2 border-b px-4 py-3">
        <ClipboardList className="mt-0.5 h-5 w-5 text-primary" />
        <div className="flex-1">
          <p className="text-sm font-semibold">Move to “Making”?</p>
          <p className="text-xs text-muted-foreground">
            {pending.length} order{pending.length === 1 ? "" : "s"} had a measurement
            slip printed. Choose which to start producing.
          </p>
        </div>
        <button
          onClick={handleDismiss}
          aria-label="Dismiss"
          className="rounded p-1 text-muted-foreground hover:bg-accent"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {pending.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">
          <Check className="mx-auto mb-2 h-5 w-5 text-emerald-600" />
          All queued orders have been moved to Making. Dismiss this prompt when
          you are ready.
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 px-4 py-2">
            <Checkbox
              checked={allSelected}
              onCheckedChange={(v) => toggleAll(v === true)}
              aria-label={allSelected ? "Deselect all" : "Select all"}
            />
            <span className="text-xs text-muted-foreground">
              {allSelected ? "All selected" : `Select all (${pending.length})`}
            </span>
          </div>

          <ScrollArea className="max-h-[220px]">
            <ul className="px-2 pb-2">
              {pending.map((c) => (
                <li
                  key={c.orderId}
                  className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-accent/50"
                >
                  <Checkbox
                    checked={!!selected[c.orderId]}
                    onCheckedChange={(v) => toggle(c.orderId, v === true)}
                    aria-label={`Select order ${c.orderNumber ?? c.orderId}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {c.orderNumber ?? c.orderId}
                    </p>
                    <p className="text-xs text-muted-foreground">from {c.fromLabel}</p>
                  </div>
                </li>
              ))}
            </ul>
          </ScrollArea>
        </>
      )}

      <div className="flex items-center gap-2 border-t px-4 py-3">
        {pending.length > 0 && (
          <Button
            onClick={handleConfirm}
            disabled={busy || selectedIds.length === 0}
            className="flex-1"
          >
            <Check className="mr-1 h-4 w-4" />
            {busy ? "Applying…" : `Change to Making (${selectedIds.length})`}
          </Button>
        )}
        <Button
          variant="outline"
          onClick={handleDismiss}
          disabled={busy}
          className={pending.length === 0 ? "w-full" : ""}
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}
