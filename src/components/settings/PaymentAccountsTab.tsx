import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CreditCard, Loader2, Pencil, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import { canCreateBusinessResources } from "@/lib/accounts/rolePresentation";
import {
  paymentAccountState,
  paymentProviderLabel,
  type PaymentAccountRow,
} from "@/lib/paymentAccounts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PaymentAccountDialog } from "@/components/payments/PaymentAccountDialog";

/**
 * Settings → Payment accounts (Task 10, spec §4): one payment account per
 * business (bKash, Nagad, Stripe, card…), never per brand. Each order source
 * toggles which methods it accepts on its own dialog; cash / manual stays
 * always available for staff-entered orders.
 */
const PaymentAccountsTab = () => {
  const { active, myRole } = useBusinessContext();
  const canCreate = canCreateBusinessResources(myRole);
  const [accounts, setAccounts] = useState<PaymentAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; account: PaymentAccountRow | null }>({
    open: false,
    account: null,
  });

  const load = useCallback(async () => {
    if (!active) {
      setAccounts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("payment_accounts")
        .select("*")
        .eq("business_id", active.id)
        .order("name");
      if (err) throw err;
      setAccounts((data as PaymentAccountRow[]) || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load payment accounts");
    } finally {
      setLoading(false);
    }
  }, [active]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
          <CreditCard className="h-4 w-4 text-muted-foreground" />
        </div>
        <div>
          <h2 className="font-heading text-lg font-semibold">Payment accounts</h2>
          <p className="text-sm text-muted-foreground">
            Gateway credentials for the whole business. Each order source picks
            which methods it accepts; cash / manual is always available for
            staff-entered orders.
          </p>
        </div>
        {canCreate && active && (
          <Button size="sm" className="ml-auto" onClick={() => setDialog({ open: true, account: null })}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New account
          </Button>
        )}
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <p className="text-sm flex-1">{error}</p>
          <Button size="sm" variant="outline" onClick={load}>Retry</Button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin" aria-label="Loading payment accounts" />
        </div>
      ) : accounts.length === 0 ? (
        <div role="status" className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No payment accounts yet. Add the business's bKash / Nagad / Stripe /
            card gateway account once — every brand uses it at checkout.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>State</TableHead>
              {canCreate && <TableHead className="w-16"><span className="sr-only">Actions</span></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((accountRow) => {
              const state = paymentAccountState(accountRow);
              return (
                <TableRow key={accountRow.id}>
                  <TableCell className="font-medium">{accountRow.name}</TableCell>
                  <TableCell>{paymentProviderLabel(accountRow.provider)}</TableCell>
                  <TableCell>
                    {state === "configured" && <Badge variant="default">Configured</Badge>}
                    {state === "needs_setup" && (
                      <Badge variant="outline" className="text-amber-400 border-amber-500/30">Setup incomplete</Badge>
                    )}
                    {state === "inactive" && <Badge variant="secondary">Inactive</Badge>}
                  </TableCell>
                  {canCreate && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setDialog({ open: true, account: accountRow })}
                        aria-label={`Edit ${accountRow.name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <PaymentAccountDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        businessId={active?.id ?? ""}
        account={dialog.account}
        onSaved={load}
      />
    </div>
  );
};

export default PaymentAccountsTab;
