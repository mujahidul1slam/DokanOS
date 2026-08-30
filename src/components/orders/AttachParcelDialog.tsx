import { useState, useEffect } from "react";
import { Link2, Loader2, AlertTriangle } from "lucide-react";
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
  onAttached: () => void;
}

export default function AttachParcelDialog({
  open,
  onOpenChange,
  orderId,
  orderNumber,
  existingConsignmentId,
  onAttached,
}: AttachParcelDialogProps) {
  const { toast } = useToast();
  const [consignmentId, setConsignmentId] = useState("");
  const [integrations, setIntegrations] = useState<PathaoIntegration[]>([]);
  const [selectedIntegration, setSelectedIntegration] = useState("");
  const [loading, setLoading] = useState(false);

  const isReplace = !!existingConsignmentId;

  // Load active Pathao integrations
  useEffect(() => {
    if (!open) return;
    setConsignmentId("");
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

  const handleAttach = async () => {
    const cid = consignmentId.trim();
    if (!cid) {
      toast({ title: "Enter a consignment ID", variant: "destructive" });
      return;
    }
    if (!selectedIntegration && integrations.length > 0) {
      toast({ title: "Select a Pathao account", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("pathao-courier", {
        body: {
          action: "attach_parcel",
          order_id: orderId,
          consignment_id: cid,
          integration_id: selectedIntegration || undefined,
          replace: isReplace,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const info = data?.data || data;
      toast({
        title: isReplace ? "Parcel replaced" : "Parcel attached",
        description: `Consignment ${info.consignment_id} — Status: ${info.tracking_status}. Tracking will update automatically every 15 min.`,
      });
      onOpenChange(false);
      onAttached();
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isReplace ? "Replace" : "Attach"} Pathao Parcel — #{orderNumber}
          </DialogTitle>
          <DialogDescription>
            {isReplace
              ? `Current consignment: ${existingConsignmentId}. Enter the new consignment ID to replace it.`
              : "Enter the Pathao consignment ID to link this order to a courier parcel."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {isReplace && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground">
                The current consignment <strong className="text-foreground">{existingConsignmentId}</strong> will
                be detached. The old parcel will no longer be tracked for this order.
              </p>
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
              onKeyDown={(e) => e.key === "Enter" && !loading && handleAttach()}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            The current Pathao tracking status will be fetched immediately. After that,
            tracking updates automatically every 15 minutes.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleAttach} disabled={loading || !consignmentId.trim()} className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            {isReplace ? "Replace Parcel" : "Attach Parcel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
