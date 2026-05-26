import { supabase } from "@/integrations/supabase/client";
import { addOrderTimeline } from "@/lib/orderTimeline";
import { logAction } from "@/lib/auditLog";

export interface RecordDuePaymentInput {
  orderId: string;
  orderNumber?: string;
  method: string;
  amount: number;
  trxId?: string | null;
  notes?: string | null;
}

/**
 * Insert an order_payments row for a due collection and recompute the order's
 * payment_status + amount_to_collect. Use for any flow that flips an unpaid /
 * partial order to fully (or partially) paid — bulk Mark Paid, pickup payment
 * dialog, Pathao COD auto-clear, etc.
 *
 * Returns the new payment_status the order was set to.
 */
export async function recordDuePayment({
  orderId,
  orderNumber,
  method,
  amount,
  trxId,
  notes,
}: RecordDuePaymentInput): Promise<"paid" | "partial" | "unpaid"> {
  // 1. Insert payment row
  await supabase.from("order_payments").insert({
    order_id: orderId,
    method,
    amount,
    trx_id: trxId || null,
    notes: notes || null,
  });

  // 2. Recompute totals
  const [{ data: ord }, { data: pays }] = await Promise.all([
    supabase.from("orders").select("total, payment_status").eq("id", orderId).single(),
    supabase.from("order_payments").select("amount").eq("order_id", orderId),
  ]);
  if (!ord) return "unpaid";
  const totalPaid = (pays || []).reduce((s, p: any) => s + Number(p.amount || 0), 0);
  const orderTotal = Number(ord.total || 0);
  const remaining = Math.max(orderTotal - totalPaid, 0);
  const newStatus: "paid" | "partial" | "unpaid" =
    totalPaid <= 0.0001 ? "unpaid" : remaining <= 0.0001 ? "paid" : "partial";

  await supabase.from("orders").update({
    payment_status: newStatus,
    amount_to_collect: remaining,
  }).eq("id", orderId);

  // 3. Timeline + audit
  await addOrderTimeline({
    order_id: orderId,
    event: "payment_logged",
    description: `Due payment of ৳${amount.toLocaleString()} via ${method}${
      trxId ? ` (TrxID: ${trxId})` : ""
    } — ${newStatus}, ৳${remaining.toLocaleString()} remaining`,
    metadata: { method, amount, trx_id: trxId || null, total_paid: totalPaid, remaining, new_status: newStatus },
  });
  await logAction("create", "order_payment", orderId, {
    order_number: orderNumber,
    method,
    amount,
    trx_id: trxId || null,
    new_payment_status: newStatus,
  });

  return newStatus;
}
