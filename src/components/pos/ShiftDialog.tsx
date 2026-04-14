import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Clock, DollarSign, TrendingUp, CreditCard, Smartphone, Building2, Banknote } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

interface Props {
  open: boolean;
  onClose: () => void;
  currentShift: any | null;
  onShiftChange: (shift: any | null) => void;
}

const ShiftDialog = ({ open, onClose, currentShift, onShiftChange }: Props) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [openingFloat, setOpeningFloat] = useState("");
  const [closingBalance, setClosingBalance] = useState("");
  const [closingNotes, setClosingNotes] = useState("");
  const [loading, setLoading] = useState(false);

  const openShift = async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("pos_shifts" as any)
      .insert({
        user_id: user.id,
        user_email: user.email,
        opening_float: parseFloat(openingFloat) || 0,
        status: "open",
      })
      .select()
      .single();
    if (data) {
      onShiftChange(data);
      toast({ title: "Shift opened", description: `Float: ৳${parseFloat(openingFloat) || 0}` });
    }
    setLoading(false);
    setOpeningFloat("");
    onClose();
  };

  const closeShift = async () => {
    if (!currentShift) return;
    setLoading(true);
    const closing = parseFloat(closingBalance) || 0;
    const expected = currentShift.opening_float + currentShift.cash_sales - currentShift.total_returns;

    await supabase
      .from("pos_shifts" as any)
      .update({
        status: "closed",
        closing_balance: closing,
        expected_balance: expected,
        notes: closingNotes || null,
        closed_at: new Date().toISOString(),
      })
      .eq("id", currentShift.id);

    onShiftChange(null);
    toast({ title: "Shift closed", description: `Closing: ৳${closing} | Expected: ৳${expected}` });
    setLoading(false);
    setClosingBalance("");
    setClosingNotes("");
    onClose();
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <Clock className="h-5 w-5" /> {currentShift ? "Close Shift" : "Open Shift"}
          </DialogTitle>
          <DialogDescription>
            {currentShift ? "End your shift and reconcile the register" : "Start a new POS shift"}
          </DialogDescription>
        </DialogHeader>

        {!currentShift ? (
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Opening Float (৳)</Label>
              <Input
                type="number"
                value={openingFloat}
                onChange={(e) => setOpeningFloat(e.target.value)}
                placeholder="0"
                className="mt-1 bg-secondary text-lg"
              />
            </div>
            <Button onClick={openShift} disabled={loading} className="w-full h-12">
              {loading ? "Opening..." : "Open Shift"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Shift Summary */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md bg-secondary p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">Total Sales</p>
                <p className="text-lg font-heading font-semibold">৳{Number(currentShift.total_sales).toLocaleString()}</p>
              </div>
              <div className="rounded-md bg-secondary p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">Transactions</p>
                <p className="text-lg font-heading font-semibold">{currentShift.transaction_count}</p>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              <div className="rounded-md bg-secondary p-2">
                <Banknote className="h-3.5 w-3.5 mx-auto mb-1 text-green-500" />
                <p className="font-semibold">৳{Number(currentShift.cash_sales).toLocaleString()}</p>
                <p className="text-muted-foreground">Cash</p>
              </div>
              <div className="rounded-md bg-secondary p-2">
                <CreditCard className="h-3.5 w-3.5 mx-auto mb-1 text-blue-500" />
                <p className="font-semibold">৳{Number(currentShift.card_sales).toLocaleString()}</p>
                <p className="text-muted-foreground">Card</p>
              </div>
              <div className="rounded-md bg-secondary p-2">
                <Smartphone className="h-3.5 w-3.5 mx-auto mb-1 text-pink-500" />
                <p className="font-semibold">৳{Number(currentShift.bkash_sales).toLocaleString()}</p>
                <p className="text-muted-foreground">bKash</p>
              </div>
              <div className="rounded-md bg-secondary p-2">
                <Building2 className="h-3.5 w-3.5 mx-auto mb-1 text-orange-500" />
                <p className="font-semibold">৳{Number(currentShift.bank_sales).toLocaleString()}</p>
                <p className="text-muted-foreground">Bank</p>
              </div>
            </div>

            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground mb-1">Expected Cash in Drawer</p>
              <p className="text-lg font-heading font-semibold">
                ৳{(currentShift.opening_float + currentShift.cash_sales - currentShift.total_returns).toLocaleString()}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                Float ৳{Number(currentShift.opening_float).toLocaleString()} + Cash Sales ৳{Number(currentShift.cash_sales).toLocaleString()} - Returns ৳{Number(currentShift.total_returns).toLocaleString()}
              </p>
            </div>

            <div>
              <Label className="text-xs">Actual Closing Balance (৳)</Label>
              <Input
                type="number"
                value={closingBalance}
                onChange={(e) => setClosingBalance(e.target.value)}
                placeholder="Count your drawer..."
                className="mt-1 bg-secondary text-lg"
              />
              {closingBalance && (() => {
                const expected = currentShift.opening_float + currentShift.cash_sales - currentShift.total_returns;
                const diff = parseFloat(closingBalance) - expected;
                return (
                  <p className={`text-xs mt-1 ${Math.abs(diff) < 1 ? "text-green-500" : "text-destructive"}`}>
                    {Math.abs(diff) < 1 ? "✓ Balanced" : diff > 0 ? `+৳${diff.toLocaleString()} over` : `-৳${Math.abs(diff).toLocaleString()} short`}
                  </p>
                );
              })()}
            </div>

            <Textarea
              value={closingNotes}
              onChange={(e) => setClosingNotes(e.target.value)}
              placeholder="Shift notes..."
              className="bg-secondary min-h-[50px]"
            />

            <Button onClick={closeShift} disabled={loading} className="w-full h-12" variant="destructive">
              {loading ? "Closing..." : "Close Shift"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ShiftDialog;
