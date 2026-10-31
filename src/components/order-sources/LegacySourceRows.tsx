import {
  LEGACY_BRAND_STORE_MAPPING,
  LEGACY_STOREFRONT_MAPPING,
  LEGACY_WOO_STORE_MAPPING,
  legacySellingPointMapping,
} from "@/lib/orderSources";
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
export interface LegacySellingPointRow {
  id: string;
  brand_id: string;
  name: string;
  type: string;
  is_active: boolean;
}
export interface LegacyBrandStoreRow {
  id: string;
  brand_id: string;
  name: string;
  store_type: string;
}
export interface LegacyStorefrontRow {
  id: string;
  brand_id: string | null;
  name: string;
  slug: string;
  is_active: boolean;
}

export interface LegacyRows {
  stores: LegacyStoreRow[];
  sellingPoints: LegacySellingPointRow[];
  brandStores: LegacyBrandStoreRow[];
  storefronts: LegacyStorefrontRow[];
}

interface Row {
  key: string;
  kind: string;
  name: string;
  detail: string;
  mapsTo: string;
}

/**
 * Read-only view of the pre-revamp rows that still hold this brand's channels
 * and stores (spec §7). They collapse into real order sources at the mapping
 * migration (Task 8) — until then this section keeps them visible on the page
 * with their future mapping, and nothing here is editable.
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
    ...rows.sellingPoints.map((sp) => ({
      key: `sp-${sp.id}`,
      kind: "Selling point",
      name: sp.name,
      detail: `${sp.type}${sp.is_active ? "" : " · inactive"}`,
      mapsTo: legacySellingPointMapping(sp.type),
    })),
    ...rows.brandStores.map((bs) => ({
      key: `bs-${bs.id}`,
      kind: "Brand store",
      name: bs.name,
      detail: bs.store_type,
      mapsTo: LEGACY_BRAND_STORE_MAPPING,
    })),
    ...rows.storefronts.map((sf) => ({
      key: `sf-${sf.id}`,
      kind: "Storefront",
      name: sf.name,
      detail: `/${sf.slug}${sf.is_active ? "" : " · inactive"}`,
      mapsTo: LEGACY_STOREFRONT_MAPPING,
    })),
  ];

  if (items.length === 0) return null;

  return (
    <section aria-label="Legacy rows, not yet migrated" className="rounded-md border border-dashed border-border bg-secondary/20 p-4">
      <h3 className="text-sm font-medium">Legacy rows — not yet migrated (read-only)</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Pre-revamp tables still hold this brand's channels and stores. They collapse
        into the order sources above at the mapping migration — the mapping column
        shows what each row becomes. Nothing here is editable and nothing is lost.
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
