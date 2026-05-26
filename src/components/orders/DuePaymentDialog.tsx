import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export interface DuePaymentResult {
  method: string;
  amount: number;
  trxId: string | null;
  notes: string | null;
}

interface DuePaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Outstanding due amount (default value for the amount field). */
  defaultAmount: number;
  /** If true, hide the amount field — caller will apply chosen method to many orders' full dues. */
  bulkMode?: boolean;
  /** Bulk order count (only shown when bulkMode). */
  bulkCount?: number;
  title?: string;
  onConfirm: (result: DuePaymentResult) => void | Promise<void>;
}

const METHODS = [
  { value: "cash", label: "Cash (drawer)" },
  { value: "bkash", label: "bKash" },
  { value: "nagad", label: "Nagad" },
  { value: "rocket", label: "Rocket" },
  { value: "card", label: "Card" },
  { value: "bank", label: "Bank Transfer" },
  { value: "cod", label: "Cash on Delivery (courier)" },
];

const DuePaymentDialog = ({
  open,
  onOpenChange,
  defaultAmount,
  bulkMode = false,
  bulkCount = 0,
  title,
  onConfirm,
}: DuePaymentDialogProps) => {
  const [method, setMethod] = useState("cash");
  const [amount, setAmount] = useState<string>("");
  const [trxId, setTrxId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setAmount(defaultAmount ? String(defaultAmount) : "");
      setTrxId("");
      setNotes("");
      setMethod("cash");
    }
  }, [open, defaultAmount]);

  const isCashLike = method === "cash" || method === "cod";

  const handleConfirm = async () => {
    const amt = bulkMode ? defaultAmount : parseFloat(amount);
    if (!bulkMode && (!amt || amt <= 0)) return;
    setSaving(true);
    try {
      await onConfirm({
        method,
        amount: amt,
        trxId: trxId.trim() || null,
        notes: notes.trim() || null,
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title || "Collect Due"}</DialogTitle>
          <DialogDescription>
            {bulkMode
              ? `Apply this payment method to the full outstanding balance of ${bulkCount} order(s).`
              : `Record how the customer paid the outstanding ৳${defaultAmount.toLocaleString()}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Payment Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!bulkMode && (
            <div className="space-y-1.5">
              <Label className="text-xs">Amount Received (৳)</Label>
              <Input
                type="number"
                min={0}
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-9"
              />
              {amount && parseFloat(amount) > 0 && parseFloat(amount) < defaultAmount && (
                <p className="text-[11px] text-muted-foreground">
                  ৳{(defaultAmount - parseFloat(amount)).toLocaleString()} will remain due.
                </p>
              )}
            </div>
          )}

          {!isCashLike && (
            <div className="space-y-1.5">
              <Label className="text-xs">Transaction ID (optional)</Label>
              <Input value={trxId} onChange={(e) => setTrxId(e.target.value)} className="h-9" />
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="text-sm" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={saving || (!bulkMode && (!amount || parseFloat(amount) <= 0))}>
            {saving ? "Saving…" : "Record Payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DuePaymentDialog;
