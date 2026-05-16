import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { fmtBDT } from "../lib/brand";

export default function Track() {
  const [num, setNum] = useState("");
  const [loading, setLoading] = useState(false);
  const [order, setOrder] = useState<any | null | undefined>(undefined);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!num.trim()) return;
    setLoading(true);
    const { data } = await supabase
      .from("orders")
      .select("order_number,status,tracking_status,payment_status,total,customer_name,created_at,consignment_id")
      .eq("order_number", num.trim())
      .maybeSingle();
    setOrder(data || null);
    setLoading(false);
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-20">
      <h1 className="sf-display text-5xl mb-8">Track order</h1>
      <form onSubmit={search} className="flex gap-3 mb-10">
        <input value={num} onChange={(e) => setNum(e.target.value)} placeholder="Order number"
          className="flex-1 bg-background border border-input rounded-full px-5 py-3 focus:outline-none focus:border-primary"/>
        <button disabled={loading} className="px-7 py-3 rounded-full bg-primary text-primary-foreground text-sm uppercase tracking-widest inline-flex items-center gap-2">
          {loading && <Loader2 className="h-4 w-4 animate-spin"/>}
          Track
        </button>
      </form>
      {order === null && <p className="text-muted-foreground">No order found with that number.</p>}
      {order && (
        <div className="sf-glass p-6 space-y-3">
          <div className="flex justify-between"><span className="text-muted-foreground text-sm">Order</span><span className="font-medium">#{order.order_number}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground text-sm">Customer</span><span>{order.customer_name}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground text-sm">Status</span><span className="uppercase tracking-wider text-xs">{order.status}</span></div>
          {order.tracking_status && <div className="flex justify-between"><span className="text-muted-foreground text-sm">Courier</span><span>{order.tracking_status}</span></div>}
          <div className="flex justify-between"><span className="text-muted-foreground text-sm">Payment</span><span className="uppercase tracking-wider text-xs">{order.payment_status}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground text-sm">Total</span><span>{fmtBDT(Number(order.total))}</span></div>
        </div>
      )}
    </div>
  );
}
