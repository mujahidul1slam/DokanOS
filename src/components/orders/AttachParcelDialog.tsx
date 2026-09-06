import { useState, useEffect } from "react";
import { Link2, Loader2, AlertTriangle, RefreshCw, PlusCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

interface PathaoIntegration {
  id: string;
  name: string;
  is_active: boolean;
}

interface AttachParcelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  orderNumber: string;
  existingConsignmentId?: string | null;
  existingEntryCount?: number;
  onAttached: () => void;
}

export default function AttachParcelDialog({
  open,
  onOpenChange,
  orderId,
  orderNumber,
  existingConsignmentId,
  existingEntryCount,
  onAttached,
}: AttachParcelDialogProps) {
  const { toast } = useToast();
  const [consignmentId, setConsignmentId] = useState("");
  const [integrations, setIntegrations] = useState<PathaoIntegration[]>([]);
  const [selectedIntegration, setSelectedIntegration] = useState("");
  const [loading, setLoading] = useState(false);

  // Confirmation dialog for choosing Overwrite vs Add New
  const [confirmChoiceOpen, setConfirmChoiceOpen] = useState(false);

  // Pathao cancellation failure dialog with force option
  const [pathaoFailDialog, setPathaoFailDialog] = useState<{
    open: boolean;
    reason: string;
    consignmentId: string;
  } | null>(null);

  const hasExistingEntries = !!existingConsignmentId || (existingEntryCount !== undefined && existingEntryCount > 0);

  // Load active Pathao integrations
  useEffect(() => {
    if (!open) return;
    setConsignmentId("");
    setConfirmChoiceOpen(false);
    setPathaoFailDialog(null);
    (async () => {
      const { data } = await supabase
        .from("pathao_integrations_safe" as any)
        .select("id, name, is_active")
        .eq("is_active", true)
        .order("name");
      const list = (data || []) as unknown as PathaoIntegration[];
      setIntegrations(list);
      if (list.length === 1) setSelectedIntegration(list[0].id);
      else if (list.length > 0 && !selectedIntegration) setSelectedIntegration(list[0].id);
    })();
  }, [open]);

  const handleInitialSubmit = () => {
    const cid = consignmentId.trim();
    if (!cid) {
      toast({ title: "Enter a consignment ID", variant: "destructive" });
      return;
    }
    if (!selectedIntegration && integrations.length > 0) {
      toast({ title: "Select a Pathao account", variant: "destructive" });
      return;
    }

    if (hasExistingEntries) {
      setConfirmChoiceOpen(true);
    } else {
      executeAttach("single");
    }
  };

  const executeAttach = async (
    mode: "single" | "replace" | "add_new",
    force = false,
  ) => {
    const cid = consignmentId.trim();
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("pathao-courier", {
        body: {
          action: "attach_parcel",
          order_id: orderId,
          consignment_id: cid,
          integration_id: selectedIntegration || undefined,
          replace: mode === "replace",
          add_new: mode === "add_new",
          force,
        },
      });

      if (error) {
        // If the edge function returned non-200, check if error payload had pathao_failed
        try {
          const body = JSON.parse(error.message);
          if (body?.pathao_failed) {
            setConfirmChoiceOpen(false);
            setPathaoFailDialog({
              open: true,
              reason: body.reason || body.error || "Order cancellation rejected by Pathao",
              consignmentId: body.consignment_id || existingConsignmentId || "",
            });
            return;
          }
        } catch {
          // not JSON, continue
        }
        throw error;
      }

      if (data?.pathao_failed) {
        setConfirmChoiceOpen(false);
        setPathaoFailDialog({
          open: true,
          reason: data.reason || data.error || "Order cancellation rejected by Pathao",
          consignmentId: data.consignment_id || existingConsignmentId || "",
        });
        return;
      }

      if (data?.error) {
        if (data.has_existing) {
          setConfirmChoiceOpen(true);
          return;
        }
        throw new Error(data.error);
      }

      const info = data?.data || data;
      const title =
        mode === "replace"
          ? "Previous parcel cancelled & new parcel attached"
          : mode === "add_new"
          ? "New courier entry added"
          : "Parcel attached";

      toast({
        title,
        description: `Consignment ${info.consignment_id} — Status: ${info.tracking_status}. Tracking updates automatically every 15 min.`,
      });

      setConfirmChoiceOpen(false);
      setPathaoFailDialog(null);
      onOpenChange(false);
      onAttached();
    } catch (err: any) {
      toast({ title: "Failed to attach parcel", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {hasExistingEntries ? "Attach Additional / Replace Courier Entry" : "Attach Pathao Parcel"} — #{orderNumber}
            </DialogTitle>
            <DialogDescription>
              {hasExistingEntries
                ? `Order has existing courier entries (current: ${existingConsignmentId || "active"}). Enter the consignment ID below.`
                : "Enter the Pathao consignment ID to link this order to a courier parcel."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {hasExistingEntries && (
              <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>
                    This order already has an active courier entry:{" "}
                    <strong className="text-foreground">{existingConsignmentId || "attached"}</strong>.
                  </p>
                  <p>
                    When you proceed, you will be prompted to either <strong>overwrite</strong> (cancel previous parcel) or <strong>add as a new entry</strong>.
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-sm">Pathao Account</Label>
              {integrations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active Pathao accounts. Add one in Integrations.</p>
              ) : integrations.length === 1 ? (
                <Input value={integrations[0].name} disabled className="h-9" />
              ) : (
                <Select value={selectedIntegration} onValueChange={setSelectedIntegration}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select account" /></SelectTrigger>
                  <SelectContent>
                    {integrations.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm">Consignment ID</Label>
              <Input
                value={consignmentId}
                onChange={(e) => setConsignmentId(e.target.value)}
                placeholder="e.g. DT2607XXXXXX"
                autoFocus
                className="h-9 font-mono"
                onKeyDown={(e) => e.key === "Enter" && !loading && handleInitialSubmit()}
              />
            </div>

            <p className="text-xs text-muted-foreground">
              The live Pathao tracking status will be verified immediately upon attaching.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button onClick={handleInitialSubmit} disabled={loading || !consignmentId.trim()} className="gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              {hasExistingEntries ? "Continue..." : "Attach Parcel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog: Overwrite vs Add New vs Cancel */}
      <AlertDialog open={confirmChoiceOpen} onOpenChange={setConfirmChoiceOpen}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <div className="flex items-center gap-2 text-amber-500">
              <AlertTriangle className="h-5 w-5" />
              <AlertDialogTitle>Courier Entry Already Exists</AlertDialogTitle>
            </div>
            <AlertDialogDescription className="space-y-2 pt-2 text-foreground">
              <p className="text-sm text-muted-foreground">
                Order #{orderNumber} already has courier entries (active: <span className="font-semibold text-foreground">{existingConsignmentId || "previous"}</span>).
              </p>
              <p className="text-sm text-muted-foreground">
                How would you like to attach new consignment <strong className="font-mono text-foreground">{consignmentId}</strong>?
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 py-2">
            <button
              type="button"
              onClick={() => executeAttach("replace")}
              disabled={loading}
              className="w-full text-left p-3 rounded-lg border border-border hover:border-amber-500/50 hover:bg-amber-500/5 transition-all flex items-start gap-3 group"
            >
              <RefreshCw className="h-4 w-4 text-amber-500 mt-0.5 shrink-0 group-hover:rotate-180 transition-transform duration-300" />
              <div>
                <p className="text-sm font-semibold text-foreground">Overwrite Previous Entry</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Attempts to cancel the previous parcel on Pathao, marks it cancelled in DokanOS, and makes this new consignment the active entry.
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => executeAttach("add_new")}
              disabled={loading}
              className="w-full text-left p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-all flex items-start gap-3 group"
            >
              <PlusCircle className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-foreground">Add as New Courier Entry</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Keeps the previous courier entries intact in history and records this consignment as an additional entry.
                </p>
              </div>
            </button>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Pathao Cancellation Failed Dialog (with Force Overwrite option) */}
      <AlertDialog
        open={!!pathaoFailDialog?.open}
        onOpenChange={(open) => !open && setPathaoFailDialog(null)}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <AlertDialogTitle>Pathao Cancellation Failed</AlertDialogTitle>
            </div>
            <AlertDialogDescription className="space-y-2 pt-2">
              <p className="text-sm text-muted-foreground">
                Pathao rejected cancellation of parcel <strong className="font-mono text-foreground">{pathaoFailDialog?.consignmentId}</strong>:
              </p>
              <div className="rounded-md bg-destructive/10 border border-destructive/20 p-2.5 text-xs text-destructive font-mono">
                {pathaoFailDialog?.reason}
              </div>
              <p className="text-xs text-muted-foreground">
                Do you want to proceed anyway and mark the previous parcel cancelled locally in DokanOS?
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Abort</AlertDialogCancel>
            <AlertDialogAction
              disabled={loading}
              onClick={() => executeAttach("replace", true)}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              Force Overwrite Locally
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
