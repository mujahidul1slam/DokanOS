import { useEffect, useState } from "react";
import { Plug } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import { Badge } from "@/components/ui/badge";
import { ConnectorSection } from "@/components/integrations/ConnectorSection";
import { IntegrationsSkeleton } from "@/components/integrations/IntegrationsSkeleton";
import { OrderSourcesPanel } from "@/components/integrations/OrderSourcesPanel";
import { CourierServicesPanel } from "@/components/integrations/CourierServicesPanel";
import type { PathaoSummaryRow } from "@/components/integrations/types";

/**
 * Platform-level Pathao connection: admin-global and read-only. RLS may hide
 * it from non-admins; that is not a page failure, so its error is deliberately
 * ignored and the box simply stays hidden.
 */
function PathaoPlatformCard() {
  const [pathao, setPathao] = useState<PathaoSummaryRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("pathao_integrations")
      .select("id, name, environment, is_active")
      .order("name")
      .then(({ data }) => {
        if (!cancelled) setPathao(((data ?? []) as unknown as PathaoSummaryRow[]) || []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (pathao.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Platform Pathao connection · admin-managed, read-only
      </p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {pathao.map((integration) => (
          <li key={integration.id}>
            <Badge variant="outline" className="font-normal">
              {integration.name || "Pathao"}
              {integration.environment ? ` · ${integration.environment}` : ""}
              {` · ${integration.is_active ? "Active" : "Inactive"}`}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Integrations — the single management surface for everything that connects
 * the business to the outside world: order sources (per brand, including the
 * default source the Add Order form starts with) and courier services (one
 * account per business). Everything that used to live under Settings →
 * Order sources / Courier services is configured here.
 */
export default function Integrations() {
  const { active, loading: ctxLoading } = useBusinessContext();

  return (
    <div className="space-y-8">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary">
          <Plug className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h1 className="font-heading text-xl font-semibold">Integrations</h1>
          <p className="text-sm text-muted-foreground">
            The places orders come from and the couriers that deliver them —
            configure everything here.
          </p>
        </div>
      </div>

      {ctxLoading ? (
        <IntegrationsSkeleton />
      ) : !active ? (
        <div role="status" className="rounded-lg border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">
            Select a business to see its integrations.
          </p>
        </div>
      ) : (
        <>
          <OrderSourcesPanel />
          <CourierServicesPanel />
          <PathaoPlatformCard />
        </>
      )}
    </div>
  );
}
