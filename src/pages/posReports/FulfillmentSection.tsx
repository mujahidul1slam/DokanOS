import {
  Truck, CheckCircle2, Clock, AlertTriangle,
} from "lucide-react";
import { FulfillCard } from "./cards";

interface FulfillStats {
  walkinDelivered: number;
  pickupPending: number;
  pickupCompleted: number;
  deliveryPending: number;
  deliveryCompleted: number;
  cancelled: number;
  returned: number;
  deliveryShippingBilled: number;
  deliveryShippingOutstanding: number;
}

interface Props {
  fulfillStats: FulfillStats;
  shippingCollected: number;
}

const FulfillmentSection = ({ fulfillStats, shippingCollected }: Props) => (
  <section className="space-y-3">
    <div>
      <h2 className="font-heading text-lg font-semibold flex items-center gap-2">
        <Truck className="h-5 w-5 text-primary" /> Fulfillment
      </h2>
      <p className="text-xs text-muted-foreground">Order counts by fulfillment status · by order date</p>
    </div>
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      <FulfillCard icon={CheckCircle2} label="Walk-in Sold" value={fulfillStats.walkinDelivered} tone="success" />
      <FulfillCard icon={Clock} label="Pickup Pending" value={fulfillStats.pickupPending} tone="warning" />
      <FulfillCard icon={CheckCircle2} label="Pickup Done" value={fulfillStats.pickupCompleted} tone="success" />
      <FulfillCard icon={Truck} label="Delivery Pending" value={fulfillStats.deliveryPending} tone="warning" />
      <FulfillCard icon={CheckCircle2} label="Delivered" value={fulfillStats.deliveryCompleted} tone="success" />
      <FulfillCard icon={AlertTriangle} label="Cancelled / Returned" value={fulfillStats.cancelled + fulfillStats.returned} tone="destructive" />
    </div>

    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-heading text-sm font-medium text-card-foreground flex items-center gap-2">
          <Truck className="h-4 w-4 text-muted-foreground" /> Delivery Charges (home delivery orders)
        </h3>
        <span className="text-[11px] text-muted-foreground">Reconcile against courier remittance</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div className="rounded-md bg-secondary/40 px-3 py-2">
          <div className="text-muted-foreground text-[11px]">Shipping Billed</div>
          <div className="font-semibold tabular-nums text-foreground">৳{fulfillStats.deliveryShippingBilled.toLocaleString()}</div>
          <div className="text-[10px] text-muted-foreground">on delivery orders in period</div>
        </div>
        <div className="rounded-md bg-secondary/40 px-3 py-2">
          <div className="text-muted-foreground text-[11px]">Shipping Collected (period)</div>
          <div className="font-semibold tabular-nums text-foreground">৳{Math.round(shippingCollected).toLocaleString()}</div>
          <div className="text-[10px] text-muted-foreground">allocated from all cash received</div>
        </div>
        <div className="rounded-md bg-secondary/40 px-3 py-2">
          <div className="text-muted-foreground text-[11px]">Shipping Outstanding</div>
          <div className="font-semibold tabular-nums text-foreground">৳{Math.round(fulfillStats.deliveryShippingOutstanding).toLocaleString()}</div>
          <div className="text-[10px] text-muted-foreground">unpaid portion attributable to shipping</div>
        </div>
      </div>
    </div>
  </section>
);

export default FulfillmentSection;
