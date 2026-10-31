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

interface LegacyCourierRow {
  key: string;
  kind: string;
  name: string;
  detail: string;
}

/**
 * Settings → Courier services (Task 9, spec §4): one courier account per
 * business, enabled at fulfillment time — no per-brand duplication. The
 * legacy per-brand courier rows stay read-only here until the mapping
 * collapses them at cutover (their ids become the `legacy_*` audit columns).
 */
const CourierServicesTab = () => {
  const { active, myRole } = useBusinessContext();
  const canCreate = canCreateBusinessResources(myRole);
  const [services, setServices] = useState<CourierServiceRow[]>([]);
  const [legacyRows, setLegacyRows] = useState<LegacyCourierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; service: CourierServiceRow | null }>({
    open: false,
    service: null,
  });

  const load = useCallback(async () => {
    if (!active) {
      setServices([]);
      setLegacyRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [svcRes, connRes] = await Promise.all([
        supabase.from("courier_services").select("*").eq("business_id", active.id).order("name"),
        supabase
          .from("connectors")
          .select("id, name, brand_id, config")
          .eq("business_id", active.id)
          .eq("category", "courier")
          .order("name"),
      ]);
      const failed = [svcRes, connRes].find((r) => r.error);
      if (failed?.error) throw failed.error;
      setServices((svcRes.data as CourierServiceRow[]) || []);
      const connectors = (connRes.data ?? []) as Array<{ id: string; name: string; config: Record<string, unknown> | null }>;
      // The legacy Pathao rows the connectors point at (id link, never names).
      const integrationIds = connectors
        .map((c) => (typeof c.config?.integration_id === "string" ? (c.config.integration_id as string) : null))
        .filter((id): id is string => !!id);
      const intRes =
        integrationIds.length > 0
          ? await supabase
              .from("pathao_integrations")
              .select("id, name, environment, is_active")
              .in("id", integrationIds)
          : { data: [], error: null };
      if (intRes.error) throw intRes.error;
      const integrations = (intRes.data ?? []) as Array<{ id: string; name: string; environment: string | null; is_active: boolean }>;
      setLegacyRows([
        ...connectors.map((c) => ({
          key: `conn-${c.id}`,
          kind: "Courier connector",
          name: c.name,
          detail: `config.integration_id → ${typeof c.config?.integration_id === "string" ? c.config.integration_id : "none"}`,
        })),
        ...integrations.map((i) => ({
          key: `int-${i.id}`,
          kind: "Pathao integration",
          name: i.name,
          detail: `${i.environment ?? "env"} · ${i.is_active ? "active" : "inactive"}`,
        })),
      ]);
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

      {legacyRows.length > 0 && (
        <section aria-label="Legacy courier rows, not yet migrated" className="rounded-md border border-dashed border-border bg-secondary/20 p-4">
          <h3 className="text-sm font-medium">Legacy courier rows — not yet migrated (read-only)</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            The old per-brand courier rows collapse into business-level services at
            the mapping migration — their ids become the service's legacy mapping.
            Nothing here is editable.
          </p>
          <Table className="mt-3">
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">Kind</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {legacyRows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="text-xs text-muted-foreground">{row.kind}</TableCell>
                  <TableCell className="text-sm">{row.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{row.detail}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
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
