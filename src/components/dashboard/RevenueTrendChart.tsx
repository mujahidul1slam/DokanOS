import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface RevenueTrendChartProps {
  data: { date: string; revenue: number; orders: number }[];
}

const RevenueTrendChart = ({ data }: RevenueTrendChartProps) => (
  <div className="col-span-1 lg:col-span-3 rounded-lg border border-border bg-card p-5">
    <h2 className="font-heading text-sm font-medium text-card-foreground">Revenue & Orders Trend</h2>
    <div className="mt-4 h-64">
      {data.length === 0 ? (
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          No data for this period
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(217,91%,60%)" stopOpacity={0.4} />
                <stop offset="100%" stopColor="hsl(217,91%,60%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(225,12%,16%)" />
            <XAxis
              dataKey="date"
              tick={{ fill: "hsl(220,8%,52%)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              yAxisId="left"
              tick={{ fill: "hsl(220,8%,52%)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                background: "hsl(225,14%,10%)",
                border: "1px solid hsl(225,12%,16%)",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "hsl(220,10%,92%)" }}
            />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="revenue"
              stroke="hsl(217,91%,60%)"
              fill="url(#rev)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  </div>
);

export default RevenueTrendChart;
