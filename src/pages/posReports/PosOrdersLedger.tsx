import { format } from "date-fns";
import { ShoppingCart } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import StatusBadge from "@/components/StatusBadge";

interface LedgerOrder {
  id: string;
  order_number: string;
  total: number;
  subtotal: number;
  discount: number | null;
  shipping_cost: number | null;
  status: string;
  payment_method: string | null;
  created_at: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  customer_city: string | null;
  salesperson_name: string | null;
}

interface Props {
  orders: LedgerOrder[];
  search: string;
  onSearchChange: (v: string) => void;
  paidByOrder: Map<string, number>;
  methodsByOrder: Map<string, string[]>;
  itemsByOrder: Map<string, number>;
  onOpen: (id: string) => void;
}

const PosOrdersLedger = ({
  orders, search, onSearchChange, paidByOrder, methodsByOrder, itemsByOrder, onOpen,
}: Props) => (
  <section className="space-y-3">
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 border-b border-border">
        <div>
          <h2 className="font-heading text-sm font-medium text-card-foreground flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-muted-foreground" /> POS Orders Ledger
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">All POS orders in selected period</p>
        </div>
        <Input
          placeholder="Search order #, customer, cashier"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-8 w-full sm:w-64 text-xs"
        />
      </div>

      {/* Mobile cards */}
      <div className="md:hidden p-3 space-y-2">
        {orders.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-10">No POS orders in this period</div>
        ) : orders.map((o) => {
          const paid = paidByOrder.get(o.id) || 0;
          const due = Math.max(0, Number(o.total) - paid);
          const ms = methodsByOrder.get(o.id) || (o.payment_method ? [o.payment_method] : []);
          const addr = [o.customer_address, o.customer_city].filter(Boolean).join(", ");
          return (
            <div key={o.id} role="button" onClick={() => onOpen(o.id)}
              className="rounded-lg border border-border bg-card p-3 active:bg-accent/50 transition-colors">
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold text-foreground truncate">#{o.order_number}</div>
                <div className="font-semibold text-foreground whitespace-nowrap">৳{Number(o.total).toLocaleString()}</div>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {format(new Date(o.created_at), "MMM d, h:mm a")}{o.salesperson_name ? ` · ${o.salesperson_name}` : ""}
              </div>
              <div className="mt-2 text-sm text-foreground truncate">{o.customer_name || "Walk-in"}</div>
              {o.customer_phone && <div className="text-xs text-muted-foreground truncate">{o.customer_phone}</div>}
              {addr && <div className="text-xs text-muted-foreground truncate">{addr}</div>}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <StatusBadge status={o.status} />
                {ms.map((m) => (<Badge key={m} variant="outline" className="text-[10px] capitalize">{m}</Badge>))}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                <div><div className="text-muted-foreground">Items</div><div className="font-medium">{itemsByOrder.get(o.id) || 0}</div></div>
                <div><div className="text-muted-foreground">Paid</div><div className="font-medium text-success">৳{paid.toLocaleString()}</div></div>
                <div><div className="text-muted-foreground">Due</div>
                  <div className={`font-medium ${due > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                    {due > 0 ? `৳${due.toLocaleString()}` : "—"}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Order #</TableHead>
              <TableHead className="text-xs">Date</TableHead>
              <TableHead className="text-xs">Customer</TableHead>
              <TableHead className="text-xs">Cashier</TableHead>
              <TableHead className="text-xs text-right">Items</TableHead>
              <TableHead className="text-xs text-right">Subtotal</TableHead>
              <TableHead className="text-xs text-right">Discount</TableHead>
              <TableHead className="text-xs text-right">Delivery</TableHead>
              <TableHead className="text-xs text-right">Total</TableHead>
              <TableHead className="text-xs text-right">Paid</TableHead>
              <TableHead className="text-xs text-right">Due</TableHead>
              <TableHead className="text-xs">Payment</TableHead>
              <TableHead className="text-xs">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.length === 0 ? (
              <TableRow><TableCell colSpan={13} className="text-center text-sm text-muted-foreground py-10">No POS orders in this period</TableCell></TableRow>
            ) : orders.map((o) => {
              const paid = paidByOrder.get(o.id) || 0;
              const due = Math.max(0, Number(o.total) - paid);
              const ms = methodsByOrder.get(o.id) || (o.payment_method ? [o.payment_method] : []);
              return (
                <TableRow key={o.id} className="text-xs cursor-pointer" onClick={() => onOpen(o.id)}>
                  <TableCell className="font-medium text-foreground">{o.order_number}</TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">{format(new Date(o.created_at), "MMM d, HH:mm")}</TableCell>
                  <TableCell className="max-w-[200px]">
                    <div className="font-medium text-foreground truncate">{o.customer_name || "Walk-in"}</div>
                    {o.customer_phone && <div className="text-[11px] text-muted-foreground truncate">{o.customer_phone}</div>}
                  </TableCell>
                  <TableCell className="max-w-[140px] truncate text-muted-foreground">{o.salesperson_name || "—"}</TableCell>
                  <TableCell className="text-right">{itemsByOrder.get(o.id) || 0}</TableCell>
                  <TableCell className="text-right">৳{Number(o.subtotal || 0).toLocaleString()}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{o.discount ? `-৳${Number(o.discount).toLocaleString()}` : "—"}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{o.shipping_cost ? `৳${Number(o.shipping_cost).toLocaleString()}` : "—"}</TableCell>
                  <TableCell className="text-right font-semibold">৳{Number(o.total).toLocaleString()}</TableCell>
                  <TableCell className="text-right text-success">৳{paid.toLocaleString()}</TableCell>
                  <TableCell className={`text-right font-medium ${due > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                    {due > 0 ? `৳${due.toLocaleString()}` : "—"}
                  </TableCell>
                  <TableCell>
                    {ms.length === 0 ? <Badge variant="outline" className="text-[10px]">—</Badge> : (
                      <div className="flex flex-wrap gap-1">
                        {ms.map((m) => (<Badge key={m} variant="outline" className="text-[10px] capitalize">{m}</Badge>))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell><StatusBadge status={o.status} /></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  </section>
);

export default PosOrdersLedger;
