import { Pencil, Plus } from "lucide-react";
import type { OrderSourceRow } from "@/lib/orderSources";
import { orderSourceConnectionState } from "@/lib/orderSources";
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
import { OrderSourceTypeBadge } from "./OrderSourceTypeBadge";
import { LegacySourceRows, type LegacyRows } from "./LegacySourceRows";

function ConnectionCell({ source }: { source: OrderSourceRow }) {
  const state = orderSourceConnectionState(source);
  if (state === "connected") return <Badge variant="default">Connected</Badge>;
  if (state === "needs_setup")
    return <Badge variant="outline" className="text-amber-400 border-amber-500/30">Setup incomplete</Badge>;
  if (state === "physical") return <Badge variant="secondary">Physical</Badge>;
  return <Badge variant="secondary">Manual</Badge>;
}

function SyncCell({ source }: { source: OrderSourceRow }) {
  const syncable = source.type === "woocommerce" || source.type === "storefront";
  if (!syncable) return <span className="text-xs text-muted-foreground">—</span>;
  if (source.last_sync_error)
    return (
      <span className="text-xs text-destructive" title={source.last_sync_error}>
        Sync error
      </span>
    );
  if (source.last_sync_at)
    return (
      <span className="text-xs text-muted-foreground">
        Synced {new Date(source.last_sync_at).toLocaleString()}
      </span>
    );
  return <span className="text-xs text-muted-foreground">Never synced</span>;
}

interface Props {
  brand: { id: string; name: string };
  sources: OrderSourceRow[];
  legacy: LegacyRows;
  canCreate: boolean;
  onAdd: (brandId: string) => void;
  onEdit: (source: OrderSourceRow) => void;
}

/** One brand's order sources (spec §2) plus its read-only legacy rows (spec §7). */
export function BrandSourceSection({ brand, sources, legacy, canCreate, onAdd, onEdit }: Props) {
  return (
    <section aria-label={`Order sources — ${brand.name}`} className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-3 p-5">
        <div className="min-w-0">
          <h2 className="font-heading text-sm font-semibold">{brand.name}</h2>
          <p className="text-xs text-muted-foreground">
            {sources.length === 0
              ? "No order sources yet"
              : `${sources.length} order source${sources.length === 1 ? "" : "s"}`}
          </p>
        </div>
        {canCreate && (
          <Button size="sm" className="ml-auto" onClick={() => onAdd(brand.id)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add source
          </Button>
        )}
      </div>

      {sources.length === 0 ? (
        <div role="status" className="border-t border-border px-5 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            An order source is one real-world place or channel orders come from —
            a showroom, a WooCommerce store, Facebook, or a manual channel like
            "Phone Orders".
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Connection</TableHead>
              <TableHead>Sync</TableHead>
              {canCreate && <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.map((source) => (
              <TableRow key={source.id}>
                <TableCell className="font-medium">{source.name}</TableCell>
                <TableCell>
                  <OrderSourceTypeBadge type={source.type} />
                  {source.is_stock_holding && (
                    <span className="ml-1.5 text-[10px] text-muted-foreground">holds stock</span>
                  )}
                </TableCell>
                <TableCell><ConnectionCell source={source} /></TableCell>
                <TableCell><SyncCell source={source} /></TableCell>
                {canCreate && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => onEdit(source)}
                      aria-label={`Edit ${source.name}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div className="p-4 pt-0">
        <LegacySourceRows rows={legacy} />
      </div>
    </section>
  );
}
