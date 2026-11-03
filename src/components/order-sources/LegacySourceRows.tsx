import { LEGACY_WOO_STORE_MAPPING } from "@/lib/orderSources";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface LegacyStoreRow {
  id: string;
  name: string;
  url: string;
  status: string;
  last_synced_at: string | null;
}

export interface LegacyRows {
  stores: LegacyStoreRow[];
}

interface Row {
  key: string;
  kind: string;
  name: string;
  detail: string;
  mapsTo: string;
}

/**
 * Read-only view of the legacy store rows that this brand's order sources were
 * mapped from (spec §7). The legacy contract tables were dropped in the Task 16
 * contract migration; what remains is the store binding row, kept visible with
 * its mapping. Nothing here is editable and no sync runs against it.
 */
export function LegacySourceRows({ rows }: { rows: LegacyRows }) {
  const items: Row[] = [
    ...rows.stores.map((s) => ({
      key: `store-${s.id}`,
      kind: "Legacy store",
      name: s.name,
      detail: `${s.url} · ${s.status}${s.last_synced_at ? ` · last synced ${new Date(s.last_synced_at).toLocaleString()}` : ""}`,
      mapsTo: LEGACY_WOO_STORE_MAPPING,
    })),
  ];

  if (items.length === 0) return null;

  return (
    <section aria-label="Legacy store binding" className="rounded-md border border-dashed border-border bg-secondary/20 p-4">
      <h3 className="text-sm font-medium">Legacy store binding (read-only)</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        The pre-revamp store record behind this brand's order sources. Its
        orders were already migrated into the sources above — nothing is
        waiting to be migrated here. The row itself is kept read-only because
        the brand's store binding (order attribution and numbering) still
        relies on it, and no sync runs against it.
      </p>
      <Table className="mt-3">
        <TableHeader>
          <TableRow>
            <TableHead className="w-28">Kind</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Detail</TableHead>
            <TableHead>Maps to</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.key}>
              <TableCell className="text-xs text-muted-foreground">{item.kind}</TableCell>
              <TableCell className="text-sm">{item.name}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{item.detail}</TableCell>
              <TableCell className="text-xs">{item.mapsTo}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
