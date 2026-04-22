interface ProductStat {
  name: string;
  qty: number;
  revenue: number;
}

interface Props {
  items: ProductStat[];
}

const TopProducts = ({ items }: Props) => {
  const max = Math.max(...items.map((i) => i.revenue), 1);

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <h2 className="font-heading text-sm font-medium text-card-foreground mb-4">Top Selling Products</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No sales in this period</p>
      ) : (
        <div className="space-y-3">
          {items.slice(0, 7).map((item, idx) => (
            <div key={item.name + idx}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-card-foreground truncate pr-2">
                  <span className="text-muted-foreground tabular-nums mr-2">#{idx + 1}</span>
                  {item.name}
                </span>
                <span className="text-muted-foreground shrink-0 tabular-nums">
                  {item.qty} sold · ৳{item.revenue.toLocaleString()}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full bg-primary/70 rounded-full"
                  style={{ width: `${(item.revenue / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TopProducts;
