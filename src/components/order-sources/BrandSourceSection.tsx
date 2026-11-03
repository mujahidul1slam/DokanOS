import { Pencil, Plus, Star } from "lucide-react";
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
  // Legacy Woo sources are read-only; only the storefront can still sync.
  const syncable = source.type === "storefront";
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

export interface RecentSourceOrder {
  id: string;
  order_number: string;
  customer_name: string | null;
  total: number;
  created_at: string;
}

export interface SourceOrderStat {
  count: number;
  recent: RecentSourceOrder[];
}

function OrdersCell({ stat }: { stat: SourceOrderStat | undefined }) {
  if (!stat || stat.count === 0) {
    return <span className="text-xs text-muted-foreground">0 orders</span>;
  }
  return (
    <div className="text-xs">
      <span className="font-medium">{stat.count} order{stat.count === 1 ? "" : "s"}</span>
      <div className="mt-0.5 space-y-0.5 text-muted-foreground">
        {stat.recent.slice(0, 2).map((o) => (
          <div key={o.id} title={`Placed ${new Date(o.created_at).toLocaleString()} · ${o.total}`}>
            {o.order_number}
            {o.customer_name ? ` · ${o.customer_name}` : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Default-source picker (one per brand): the starred source is what the Add
 * Order form starts with. Clicking the star moves the default — the panel
 * clears the brand's previous default first (one default per brand in the DB).
 */
function DefaultCell({
  source,
  canCreate,
  onSetDefault,
}: {
  source: OrderSourceRow;
  canCreate: boolean;
  onSetDefault?: (source: OrderSourceRow) => void;
}) {
  if (source.is_default) {
    return (
      <span className="inline-flex items-center gap-1 text-amber-500" aria-label={`${source.name} is the default source for new orders`}>
        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden="true" />
        <span className="text-[10px] font-medium">Default</span>
      </span>
    );
  }
  if (!canCreate || !onSetDefault) {
    return <span className="text-xs text-muted-foreground" aria-hidden="true">—</span>;
  }
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 text-muted-foreground/50 hover:text-amber-400"
      onClick={() => onSetDefault(source)}
      aria-label={`Set ${source.name} as the default source for new orders`}
      title="Default source for new orders — click to make this the default"
    >
      <Star className="h-3.5 w-3.5" aria-hidden="true" />
    </Button>
  );
}

interface Props {
  brand: { id: string; name: string };
  sources: OrderSourceRow[];
  stats: Record<string, SourceOrderStat>;
  legacy: LegacyRows;
  canCreate: boolean;
  onAdd: (brandId: string) => void;
  onEdit: (source: OrderSourceRow) => void;
  /** Mark a source as the brand's default for the Add Order form. */
  onSetDefault?: (source: OrderSourceRow) => void;
}

/** One brand's order sources (spec §2) plus its read-only legacy rows (spec §7). */
export function BrandSourceSection({ brand, sources, stats, legacy, canCreate, onAdd, onEdit, onSetDefault }: Props) {
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
            a showroom, a storefront, Facebook, or a manual channel like
            "Phone Orders".
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="w-20">Default</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Connection</TableHead>
              <TableHead>Sync</TableHead>
              <TableHead>Orders</TableHead>
              {canCreate && <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.map((source) => (
              <TableRow key={source.id}>
                <TableCell className="font-medium">{source.name}</TableCell>
                <TableCell>
                  <DefaultCell source={source} canCreate={canCreate} onSetDefault={onSetDefault} />
                </TableCell>
                <TableCell>
                  <OrderSourceTypeBadge type={source.type} />
                  {source.is_stock_holding && (
                    <span className="ml-1.5 text-[10px] text-muted-foreground">holds stock</span>
                  )}
                </TableCell>
                <TableCell><ConnectionCell source={source} /></TableCell>
                <TableCell><SyncCell source={source} /></TableCell>
                <TableCell><OrdersCell stat={stats[source.id]} /></TableCell>
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
