import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Cell, Tooltip, CartesianGrid } from "recharts";

interface Props {
  revenue: number;
  discounts: number;
  cogs: number;
  shipping: number;
  tax: number;
  netProfit: number;
}

const FinancialWaterfall = ({ revenue, discounts, cogs, shipping, tax, netProfit }: Props) => {
  const data = [
    { name: "Gross Revenue", value: revenue, fill: "hsl(217,91%,60%)" },
    { name: "Discounts", value: -discounts, fill: "hsl(0,84%,60%)" },
    { name: "COGS", value: -cogs, fill: "hsl(38,92%,50%)" },
    { name: "Shipping Cost", value: -shipping, fill: "hsl(291,64%,42%)" },
    { name: "Tax", value: -tax, fill: "hsl(199,89%,48%)" },
    { name: "Net Profit", value: netProfit, fill: netProfit >= 0 ? "hsl(142,71%,45%)" : "hsl(0,84%,60%)" },
  ];

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-4">
        <h2 className="font-heading text-sm font-medium text-card-foreground">Profit Waterfall</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Where your revenue goes</p>
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 30 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} angle={-15} textAnchor="end" height={50} />
            <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `৳${(v / 1000).toFixed(0)}k`} />
            <Tooltip
              contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
              formatter={(v: number) => `৳${Math.abs(v).toLocaleString()}`}
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default FinancialWaterfall;
