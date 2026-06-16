import { format, differenceInDays } from "date-fns";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface ArOrder {
  id: string;
  order_number: string;
  total: number;
  created_at: string;
  customer_name: string | null;
  customer_phone: string | null;
  fulfillment_type: string | null;
}

interface ArRow {
  order: ArOrder;
  paid: number;
  outstanding: number;
}

interface Props {
  out: ArRow[];
  onOpen: (id: string) => void;
}

const ArOutstandingTable = ({ out, onOpen }: Props) => {
  if (out.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="p-4 border-b border-border">
        <h3 className="font-heading text-sm font-medium text-card-foreground">Outstanding Orders</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Oldest first — click a row to collect dues</p>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Order #</TableHead>
              <TableHead className="text-xs">Date</TableHead>
              <TableHead className="text-xs">Customer</TableHead>
              <TableHead className="text-xs">Fulfillment</TableHead>
              <TableHead className="text-xs text-right">Total</TableHead>
              <TableHead className="text-xs text-right">Paid</TableHead>
              <TableHead className="text-xs text-right">Outstanding</TableHead>
              <TableHead className="text-xs text-right">Age</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {out.slice(0, 100).map((r) => {
              const days = differenceInDays(new Date(), new Date(r.order.created_at));
              const tone = days > 60 ? "text-destructive" : days > 30 ? "text-amber-600 dark:text-amber-500" : "text-foreground";
              return (
                <TableRow key={r.order.id} className="text-xs cursor-pointer" onClick={() => onOpen(r.order.id)}>
                  <TableCell className="font-medium">{r.order.order_number}</TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">{format(new Date(r.order.created_at), "MMM d, yyyy")}</TableCell>
                  <TableCell>
                    <div className="font-medium text-foreground truncate max-w-[180px]">{r.order.customer_name || "Walk-in"}</div>
                    {r.order.customer_phone && <div className="text-[11px] text-muted-foreground">{r.order.customer_phone}</div>}
                  </TableCell>
                  <TableCell className="capitalize text-muted-foreground">{r.order.fulfillment_type || "walkin"}</TableCell>
                  <TableCell className="text-right">৳{Number(r.order.total).toLocaleString()}</TableCell>
                  <TableCell className="text-right text-success">৳{r.paid.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-semibold text-destructive">৳{r.outstanding.toLocaleString()}</TableCell>
                  <TableCell className={`text-right tabular-nums ${tone}`}>{days}d</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {out.length > 100 && (
        <div className="p-3 text-center text-xs text-muted-foreground border-t border-border">
          Showing oldest 100 of {out.length} outstanding orders — export AR for full list
        </div>
      )}
    </div>
  );
};

export default ArOutstandingTable;
