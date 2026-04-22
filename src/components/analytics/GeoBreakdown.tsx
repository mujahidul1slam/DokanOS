import { MapPin } from "lucide-react";

interface Row {
  city: string;
  orders: number;
  revenue: number;
}

const GeoBreakdown = ({ data }: { data: Row[] }) => {
  const max = Math.max(1, ...data.map((d) => d.revenue));

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-4">
        <h2 className="font-heading text-sm font-medium text-card-foreground">Geographic Revenue</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Top delivery cities</p>
      </div>
      {data.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">No location data</div>
      ) : (
        <div className="space-y-2.5">
          {data.slice(0, 10).map((row, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate text-foreground">{row.city}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0 text-xs">
                  <span className="text-muted-foreground">{row.orders}</span>
                  <span className="font-semibold text-foreground">৳{row.revenue.toLocaleString()}</span>
                </div>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary/80 transition-all" style={{ width: `${(row.revenue / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default GeoBreakdown;
