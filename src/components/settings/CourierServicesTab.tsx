import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Pencil, Plus, Truck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import { canCreateBusinessResources } from "@/lib/accounts/rolePresentation";
import {
  courierProviderLabel,
  courierServiceState,
  type CourierServiceRow,
} from "@/lib/courierServices";
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
import { CourierServiceDialog } from "@/components/courier/CourierServiceDialog";

/**
 * Settings → Courier services (Task 9, spec §4): one courier account per
 * business, enabled at fulfillment time — no per-brand duplication. The
 * legacy per-brand courier connectors were dropped at the Task 16 contract
 * migration; their ids survive as the service's `legacy_*` audit columns.
 */
const CourierServicesTab = () => {
  const { active, myRole } = useBusinessContext();
  const canCreate = canCreateBusinessResources(myRole);
  const [services, setServices] = useState<CourierServiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; service: CourierServiceRow | null }>({
    open: false,
    service: null,
  });

  const load = useCallback(async () => {
    if (!active) {
      setServices([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: svcError } = await supabase
        .from("courier_services")
        .select("*")
        .eq("business_id", active.id)
        .order("name");
      if (svcError) throw svcError;
      setServices((data as CourierServiceRow[]) || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load courier services");
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
          <Truck className="h-4 w-4 text-muted-foreground" />
        </div>
        <div>
          <h2 className="font-heading text-lg font-semibold">Courier services</h2>
          <p className="text-sm text-muted-foreground">
            One courier account per business — picked at fulfillment time, never
            duplicated per brand.
          </p>
        </div>
        {canCreate && active && (
          <Button size="sm" className="ml-auto" onClick={() => setDialog({ open: true, service: null })}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New service
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
          <Loader2 className="h-6 w-6 animate-spin" aria-label="Loading courier services" />
        </div>
      ) : services.length === 0 ? (
        <div role="status" className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No courier services yet. Add the business's Pathao / Steadfast / RedX /
            eCourier account once — every brand uses it at dispatch.
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
            {services.map((service) => {
              const state = courierServiceState(service);
              return (
                <TableRow key={service.id}>
                  <TableCell className="font-medium">
                    {service.name}
                    {service.legacy_pathao_integration_id && (
                      <Badge variant="outline" className="ml-2 text-[10px]">legacy mapped</Badge>
                    )}
                  </TableCell>
                  <TableCell>{courierProviderLabel(service.provider)}</TableCell>
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
                        onClick={() => setDialog({ open: true, service })}
                        aria-label={`Edit ${service.name}`}
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

      <CourierServiceDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        businessId={active?.id ?? ""}
        service={dialog.service}
        onSaved={load}
      />
    </div>
  );
};

export default CourierServicesTab;
