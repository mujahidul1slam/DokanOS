import { ShoppingCart, DollarSign, Package, Truck } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import StatCard from "@/components/StatCard";
import StatusBadge from "@/components/StatusBadge";
import { orders, revenueData } from "@/lib/mockData";

const Dashboard = () => (
  <div className="space-y-6">
    <div>
      <h1 className="font-heading text-2xl font-semibold">Dashboard</h1>
      <p className="text-sm text-muted-foreground">Overview of your operations</p>
    </div>

    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard icon={DollarSign} title="Revenue (Today)" value="৳20,400" change="+12% from yesterday" changeType="positive" />
      <StatCard icon={ShoppingCart} title="Total Orders" value="1,042" change="+8 today" changeType="positive" />
      <StatCard icon={Package} title="Products" value="156" change="3 low stock" changeType="negative" />
      <StatCard icon={Truck} title="In Transit" value="23" change="5 arriving today" changeType="neutral" />
    </div>

    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      <div className="col-span-3 rounded-lg border border-border bg-card p-5">
        <h2 className="font-heading text-sm font-medium text-card-foreground">Revenue — Last 7 Days</h2>
        <div className="mt-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={revenueData}>
              <defs>
                <linearGradient id="online" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(217,91%,60%)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(217,91%,60%)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="pos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(142,71%,45%)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(142,71%,45%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(225,12%,16%)" />
              <XAxis dataKey="date" tick={{ fill: "hsl(220,8%,52%)", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "hsl(220,8%,52%)", fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: "hsl(225,14%,10%)", border: "1px solid hsl(225,12%,16%)", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "hsl(220,10%,92%)" }}
              />
              <Area type="monotone" dataKey="online" stroke="hsl(217,91%,60%)" fill="url(#online)" strokeWidth={2} />
              <Area type="monotone" dataKey="pos" stroke="hsl(142,71%,45%)" fill="url(#pos)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 flex gap-5">
          <span className="flex items-center gap-2 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full bg-primary" /> Online</span>
          <span className="flex items-center gap-2 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full bg-success" /> POS</span>
        </div>
      </div>

      <div className="col-span-2 rounded-lg border border-border bg-card p-5">
        <h2 className="font-heading text-sm font-medium text-card-foreground">Recent Orders</h2>
        <div className="mt-4 space-y-3">
          {orders.slice(0, 5).map((order) => (
            <div key={order.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm text-card-foreground">{order.id}</p>
                <p className="truncate text-xs text-muted-foreground">{order.customer}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-card-foreground">৳{order.total.toLocaleString()}</span>
                <StatusBadge status={order.status} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

export default Dashboard;
