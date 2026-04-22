import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

interface MixItem {
  name: string;
  value: number;
  color: string;
}

interface Props {
  title: string;
  items: MixItem[];
  formatValue?: (v: number) => string;
}

const SourceMix = ({ title, items, formatValue = (v) => v.toLocaleString() }: Props) => {
  const total = items.reduce((s, i) => s + i.value, 0);
  const data = items.filter((i) => i.value > 0);

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <h2 className="font-heading text-sm font-medium text-card-foreground mb-4">{title}</h2>
      {total === 0 ? (
        <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">No data</div>
      ) : (
        <div className="flex items-center gap-4">
          <div className="h-32 w-32 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  innerRadius={36}
                  outerRadius={60}
                  paddingAngle={2}
                  dataKey="value"
                  stroke="none"
                >
                  {data.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v: number) => formatValue(v)}
                  contentStyle={{
                    background: "hsl(225,14%,10%)",
                    border: "1px solid hsl(225,12%,16%)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex-1 space-y-2">
            {items.map((item) => {
              const pct = total === 0 ? 0 : (item.value / total) * 100;
              return (
                <div key={item.name} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 text-card-foreground">
                    <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
                    {item.name}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {formatValue(item.value)} <span className="opacity-60">({pct.toFixed(0)}%)</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default SourceMix;
