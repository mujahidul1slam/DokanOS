import { Pencil, Plus, Trash2, ArrowLeftRight } from "lucide-react";
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
import {
  parseHolderKey,
  type StockHolder,
  type WarehouseRow,
} from "@/lib/stockHolders";

export interface StockRow {
  id: string;
  product_id: string;
  variation_id: string | null;
  stock_quantity: number;
  holderKey: string;
  product: { name: string; sku: string | null } | null;
  variation: { name: string | null; sku: string | null; attributes: unknown } | null;
}

export interface TransferRow {
  id: string;
  fromKey: string | null;
  toKey: string | null;
  product: { name: string; sku: string | null } | null;
  variation: { name: string | null; sku: string | null; attributes: unknown } | null;
  quantity: number;
  status: string;
  note: string | null;
  created_at: string;
}

function transferHolderLabel(key: string | null, holders: StockHolder[]): string {
  if (!key) return "—";
  const parsed = parseHolderKey(key);
  const holder = parsed
    ? holders.find((h) => h.kind === parsed.kind && h.id === parsed.id)
    : undefined;
  return holder?.name ?? "Deleted holder";
}

const itemName = (row: { product: { name: string } | null; variation: { name: string | null } | null }): string => {
  const product = row.product?.name ?? "Unknown product";
  return row.variation?.name ? `${product} · ${row.variation.name}` : product;
};

interface Props {
  brand: { id: string; name: string };
  warehouses: WarehouseRow[];
  holders: StockHolder[];
  stockRows: StockRow[];
  transfers: TransferRow[];
  canCreate: boolean;
  onAddWarehouse: (brandId: string) => void;
  onEditWarehouse: (warehouse: WarehouseRow) => void;
  onDeleteWarehouse: (warehouse: WarehouseRow) => void;
  onTransfer: (brandId: string) => void;
}

/** One brand's stock world (spec §3): warehouses, holders, on-hand, transfers. */
export function BrandWarehouseSection({
  brand,
  warehouses,
  holders,
  stockRows,
  transfers,
  canCreate,
  onAddWarehouse,
  onEditWarehouse,
  onDeleteWarehouse,
  onTransfer,
}: Props) {
  const rowsByHolder = new Map<string, StockRow[]>();
  for (const row of stockRows) {
    const list = rowsByHolder.get(row.holderKey) ?? [];
    list.push(row);
    rowsByHolder.set(row.holderKey, list);
  }

  return (
    <section aria-label={`Warehouses — ${brand.name}`} className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-3 p-5">
        <div className="min-w-0">
          <h2 className="font-heading text-sm font-semibold">{brand.name}</h2>
          <p className="text-xs text-muted-foreground">
            {warehouses.length} warehouse{warehouses.length === 1 ? "" : "s"} · {holders.length} stock holder{holders.length === 1 ? "" : "s"}
          </p>
        </div>
        {canCreate && (
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={() => onTransfer(brand.id)}>
              <ArrowLeftRight className="h-3.5 w-3.5 mr-1" /> Transfer
            </Button>
            <Button size="sm" onClick={() => onAddWarehouse(brand.id)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> New warehouse
            </Button>
          </div>
        )}
      </div>

      {warehouses.length === 0 ? (
        <div role="status" className="border-t border-border px-5 py-6 text-center">
          <p className="text-sm text-muted-foreground">
            No warehouses yet. Warehouses hold stock only — orders never come from
            them. Showrooms and physical stores hold stock as order sources.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Warehouse</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Phone</TableHead>
              {canCreate && <TableHead className="w-20"><span className="sr-only">Actions</span></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {warehouses.map((warehouse) => (
              <TableRow key={warehouse.id}>
                <TableCell>
                  <span className="font-medium">{warehouse.name}</span>
                  {warehouse.is_default && <Badge variant="secondary" className="ml-2 text-[10px]">Default</Badge>}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {[warehouse.address, warehouse.area, warehouse.zone, warehouse.city].filter(Boolean).join(", ") || "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{warehouse.phone ?? "—"}</TableCell>
                {canCreate && (
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEditWarehouse(warehouse)} aria-label={`Edit ${warehouse.name}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onDeleteWarehouse(warehouse)} aria-label={`Delete ${warehouse.name}`}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div className="border-t border-border p-4">
        <h3 className="text-sm font-medium">On hand per stock holder</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Warehouses and stock-holding order sources. Transfers move quantities between them.
        </p>
        {holders.length === 0 ? (
          <p role="status" className="mt-3 text-xs text-muted-foreground">
            No stock holders yet — add a warehouse, or mark a showroom/physical
            store as stock-holding on the Order Sources page.
          </p>
        ) : (
          <Table className="mt-3">
            <TableHeader>
              <TableRow>
                <TableHead>Holder</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Qty</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {holders.map((holder) => {
                const rows = (rowsByHolder.get(holder.key) ?? []).sort((a, b) =>
                  itemName(a).localeCompare(itemName(b)),
                );
                if (rows.length === 0) {
                  return (
                    <TableRow key={holder.key}>
                      <TableCell className="font-medium">{holder.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {holder.kind === "warehouse" ? "Warehouse" : "Order source"}
                        </Badge>
                      </TableCell>
                      <TableCell colSpan={2} className="text-xs text-muted-foreground">No stock yet</TableCell>
                    </TableRow>
                  );
                }
                return rows.map((row, index) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      {index === 0 ? (
                        <>
                          {holder.name}
                          {holder.isDefault && <Badge variant="secondary" className="ml-2 text-[10px]">Default</Badge>}
                        </>
                      ) : (
                        <span className="text-muted-foreground">〃</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {index === 0 && (
                        <Badge variant="outline" className="text-[10px]">
                          {holder.kind === "warehouse" ? "Warehouse" : "Order source"}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{itemName(row)}</TableCell>
                    <TableCell className="text-right text-sm font-medium">{row.stock_quantity}</TableCell>
                  </TableRow>
                ));
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {transfers.length > 0 && (
        <div className="border-t border-border p-4">
          <h3 className="text-sm font-medium">Recent transfers</h3>
          <Table className="mt-3">
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>From → To</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transfers.map((transfer) => (
                <TableRow key={transfer.id}>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(transfer.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-xs">
                    {transferHolderLabel(transfer.fromKey, holders)} → {transferHolderLabel(transfer.toKey, holders)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {itemName(transfer)}
                    {transfer.note && <span className="ml-1 text-[10px] text-muted-foreground">({transfer.note})</span>}
                  </TableCell>
                  <TableCell className="text-right text-sm">{transfer.quantity}</TableCell>
                  <TableCell>
                    <Badge variant={transfer.status === "completed" ? "secondary" : "outline"} className="text-[10px]">
                      {transfer.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
