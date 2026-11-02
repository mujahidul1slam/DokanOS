import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { useCurrency } from "../lib/useCurrency";

interface TrackedOrder {
  order_number: string;
  status: string;
  tracking_status?: string | null;
  payment_status: string;
  total: number;
  created_at: string;
  consignment_id?: string | null;
}

export default function Track() {
  const fmt = useCurrency();
  const [num, setNum] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [order, setOrder] = useState<TrackedOrder | null | undefined>(undefined);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!num.trim() || !phone.trim()) return;
    setLoading(true);
    setErrorMsg(null);

    try {
      const { data, error } = await supabase.functions.invoke("storefront-track-order", {
        body: {
          order_number: num.trim(),
          phone: phone.trim(),
        },
      });

      if (error || !data || data.error) {
        let msg = "No order found matching the provided details.";
        if (data?.error) {
          msg = data.error;
        } else if (error && (error as any).context) {
          try {
            const body = await (error as any).context.json();
            if (body?.error) msg = body.error;
          } catch {}
        }
        setOrder(null);
        setErrorMsg(msg);
      } else {
        setOrder(data as TrackedOrder);
      }
    } catch {
      setOrder(null);
      setErrorMsg("Failed to track order. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-20">
      <h1 className="sf-display text-5xl mb-8">Track order</h1>
      <form onSubmit={search} className="space-y-4 mb-10">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            value={num}
            onChange={(e) => setNum(e.target.value)}
            placeholder="Order number (e.g. ORD-1001)"
            required
            className="flex-1 bg-background border border-input rounded-full px-5 py-3 focus:outline-none focus:border-primary text-sm"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone number"
            type="tel"
            required
            className="flex-1 bg-background border border-input rounded-full px-5 py-3 focus:outline-none focus:border-primary text-sm"
          />
          <button
            type="submit"
            disabled={loading || !num.trim() || !phone.trim()}
            className="px-7 py-3 rounded-full bg-primary text-primary-foreground text-sm uppercase tracking-widest inline-flex items-center justify-center gap-2 font-medium disabled:opacity-50"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Track
          </button>
        </div>
      </form>

      {order === null && (
        <p className="text-muted-foreground">{errorMsg || "No order found with that number and phone combination."}</p>
      )}

      {order && (
        <div className="sf-glass p-6 space-y-3 rounded-2xl border border-border">
          <div className="flex justify-between items-center py-1 border-b border-border/50">
            <span className="text-muted-foreground text-sm">Order</span>
            <span className="font-semibold text-foreground">#{order.order_number}</span>
          </div>
          <div className="flex justify-between items-center py-1 border-b border-border/50">
            <span className="text-muted-foreground text-sm">Status</span>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium uppercase tracking-wider bg-primary/10 text-primary">
              {order.status}
            </span>
          </div>

          {/* Status timeline */}
          <StatusTimeline status={order.status} trackingStatus={order.tracking_status} />

          {order.tracking_status && (
            <div className="flex justify-between items-center py-1 border-b border-border/50">
              <span className="text-muted-foreground text-sm">Delivery Status</span>
              <span className="text-sm font-medium">{order.tracking_status}</span>
            </div>
          )}
          {order.consignment_id && (
            <div className="flex justify-between items-center py-1 border-b border-border/50">
              <span className="text-muted-foreground text-sm">Consignment ID</span>
              <span className="text-sm font-mono">{order.consignment_id}</span>
            </div>
          )}
          <div className="flex justify-between items-center py-1 border-b border-border/50">
            <span className="text-muted-foreground text-sm">Payment</span>
            <span className="uppercase tracking-wider text-xs font-medium">{order.payment_status}</span>
          </div>
          <div className="flex justify-between items-center py-1 border-b border-border/50">
            <span className="text-muted-foreground text-sm">Date</span>
            <span className="text-sm text-muted-foreground">{new Date(order.created_at).toLocaleDateString()}</span>
          </div>
          <div className="flex justify-between items-center pt-2">
            <span className="text-muted-foreground text-sm font-medium">Total</span>
            <span className="text-lg font-bold text-foreground">{fmt(Number(order.total))}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Status timeline — steps: pending → processing → shipped → delivered. */
function StatusTimeline({ status, trackingStatus }: { status: string; trackingStatus?: string | null }) {
  const STEPS = ["pending", "processing", "shipped", "delivered"];
  // Cancelled/returned render as a terminal state badge instead of the ladder
  if (status === "cancelled" || status === "returned") {
    return (
      <div className="py-3 border-b border-border/50">
        <p className={`text-sm font-medium ${status === "cancelled" ? "text-destructive" : "text-amber-600"}`}>
          This order was {status}.
        </p>
      </div>
    );
  }
  const idx = STEPS.indexOf(status === "pre_order_pending" || status === "pre_order_making" || status === "pre_order_ready" ? "pending" : status);
  const effectiveIdx = idx === -1 ? 0 : idx;
  // tracking_status present = courier picked up → at least shipped
  const courierPicked = !!trackingStatus;
  const reached = Math.max(effectiveIdx, courierPicked ? 2 : effectiveIdx);

  return (
    <div className="py-4 border-b border-border/50">
      <div className="flex items-center">
        {STEPS.map((step, i) => {
          const done = i <= reached;
          const current = i === reached && status !== "delivered";
          return (
            <div key={step} className="flex-1 flex items-center last:flex-none">
              <div className="flex flex-col items-center gap-1.5">
                <span
                  className={`h-4 w-4 rounded-full border-2 flex items-center justify-center transition-colors ${
                    done ? "border-primary bg-primary" : "border-muted-foreground/40 bg-background"
                  }`}
                >
                  {done && <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
                </span>
                <span className={`text-[10px] uppercase tracking-wider capitalize ${current ? "text-primary font-semibold" : done ? "text-foreground" : "text-muted-foreground"}`}>
                  {step}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-2 transition-colors ${i < reached ? "bg-primary" : "bg-muted-foreground/20"}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
