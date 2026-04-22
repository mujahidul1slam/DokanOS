import { Trophy, Medal, Award } from "lucide-react";

interface Row {
  name: string;
  orders: number;
  revenue: number;
  avgOrder: number;
}

const SalespersonLeaderboard = ({ data }: { data: Row[] }) => {
  const max = Math.max(1, ...data.map((d) => d.revenue));

  const trophy = (i: number) => {
    if (i === 0) return <Trophy className="h-4 w-4 text-yellow-500" />;
    if (i === 1) return <Medal className="h-4 w-4 text-zinc-400" />;
    if (i === 2) return <Award className="h-4 w-4 text-amber-700" />;
    return <span className="text-xs text-muted-foreground w-4 text-center">{i + 1}</span>;
  };

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-4">
        <h2 className="font-heading text-sm font-medium text-card-foreground">Salesperson Leaderboard</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Top performers by revenue</p>
      </div>
      {data.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">No salesperson data</div>
      ) : (
        <div className="space-y-3">
          {data.slice(0, 8).map((row, i) => (
            <div key={row.name} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  {trophy(i)}
                  <span className="truncate text-foreground font-medium">{row.name}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0 text-xs">
                  <span className="text-muted-foreground">{row.orders} orders</span>
                  <span className="text-muted-foreground">avg ৳{Math.round(row.avgOrder).toLocaleString()}</span>
                  <span className="font-semibold text-foreground">৳{row.revenue.toLocaleString()}</span>
                </div>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${(row.revenue / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SalespersonLeaderboard;
