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
 * Read-only view of the legacy Woo-store rows that this brand's order sources
 * were mapped from (spec §7). The legacy contract tables were dropped in the
 * Task 16 contract migration; what remains is the Woo-connection record —
 * the store row each brand's WooCommerce order source syncs through, kept
 * visible here with its mapping. Nothing here is editable.
 */
export function LegacySourceRows({ rows }: { rows: LegacyRows }) {
  const items: Row[] = [
    ...rows.stores.map((s) => ({
      key: `store-${s.id}`,
      kind: "Woo store",
      name: s.name,
      detail: `${s.url} · ${s.status}${s.last_synced_at ? ` · synced ${new Date(s.last_synced_at).toLocaleString()}` : ""}`,
      mapsTo: LEGACY_WOO_STORE_MAPPING,
    })),
  ];

  if (items.length === 0) return null;

  return (
    <section aria-label="Legacy rows, not yet migrated" className="rounded-md border border-dashed border-border bg-secondary/20 p-4">
      <h3 className="text-sm font-medium">Legacy rows — not yet migrated (read-only)</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        The pre-revamp store record for this brand's WooCommerce connection. Its
        orders were mapped into the order sources above; the store row itself
        stays as the sync link. Nothing here is editable and nothing is lost.
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
