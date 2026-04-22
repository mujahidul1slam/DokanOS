import { Users, UserPlus, Repeat, Star } from "lucide-react";

interface Props {
  newCustomers: number;
  returningCustomers: number;
  repeatRate: number;
  avgLtv: number;
  topCustomers: { name: string; orders: number; revenue: number }[];
}

const CustomerInsights = ({ newCustomers, returningCustomers, repeatRate, avgLtv, topCustomers }: Props) => {
  const total = newCustomers + returningCustomers;

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-4">
        <h2 className="font-heading text-sm font-medium text-card-foreground">Customer Insights</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Acquisition vs retention</p>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="rounded-md bg-muted/40 p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <UserPlus className="h-3.5 w-3.5" /> New
          </div>
          <p className="mt-1 font-heading text-xl font-semibold text-foreground">{newCustomers}</p>
          {total > 0 && <p className="text-[10px] text-muted-foreground">{Math.round((newCustomers / total) * 100)}% of buyers</p>}
        </div>
        <div className="rounded-md bg-muted/40 p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Repeat className="h-3.5 w-3.5" /> Returning
          </div>
          <p className="mt-1 font-heading text-xl font-semibold text-foreground">{returningCustomers}</p>
          <p className="text-[10px] text-muted-foreground">{repeatRate.toFixed(1)}% repeat rate</p>
        </div>
        <div className="rounded-md bg-muted/40 p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" /> Avg LTV
          </div>
          <p className="mt-1 font-heading text-xl font-semibold text-foreground">৳{Math.round(avgLtv).toLocaleString()}</p>
        </div>
        <div className="rounded-md bg-muted/40 p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Star className="h-3.5 w-3.5" /> Total Buyers
          </div>
          <p className="mt-1 font-heading text-xl font-semibold text-foreground">{total}</p>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-medium text-muted-foreground mb-2">Top Customers</h3>
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {topCustomers.length === 0 ? (
            <div className="text-xs text-muted-foreground py-2">No data</div>
          ) : (
            topCustomers.slice(0, 6).map((c, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="truncate text-foreground">{c.name}</span>
                <div className="flex items-center gap-3 shrink-0 text-muted-foreground">
                  <span>{c.orders}x</span>
                  <span className="font-medium text-foreground">৳{c.revenue.toLocaleString()}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default CustomerInsights;
