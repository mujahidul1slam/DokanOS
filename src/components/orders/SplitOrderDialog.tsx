import { useEffect, useMemo, useState } from "react";
import { Loader2, Scissors, AlertTriangle, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { toast } from "sonner";
import { useCurrency } from "@/hooks/useCurrency";
import {
  computeSplitPlan,
  SplitPlanError,
  type SplitChargeShares,
  type SplitPaymentAssignment,
  type SplitPlan,
  type SplitPlanOrder,
  type SplitRequest,
  type SplitSourceOrder,
} from "@/lib/orderSplit";
import {
  persistOrderSplit,
  SPLIT_TAX_CHARGE_ID,
  type SplitParentOrder,
  type SplitSourceItemRow,
  type SplitSourcePaymentRow,
} from "@/lib/splitPersistence";

/**
 * SplitOrderDialog (issue #31 — "Order split with payment transfer + charge
 * allocation")
 *
 * Moves chosen products/quantities of one order into a NEW independent order
 * linked via parent_order_id (exchange-order precedent). Money semantics come
 * from computeSplitPlan (@/lib/orderSplit) and persistence from
 * persistOrderSplit (@/lib/splitPersistence) — this component is the UI:
 *   - item/quantity picker (partial quantities supported);
 *   - the three DISTINCT payment cases for the new order: COD, a new payment
 *     (method + amount), or transfer of an existing payment of the original;
 *   - optional per-result-order charge adjustment (chargeShares);
 *   - live preview of both resulting orders' totals from the plan;
 *   - plan warnings render non-blocking (staff may be correcting reality);
 *     only a SplitPlanError (invalid selection) disables confirm.
 */

type PaymentCase = "cod" | "new-payment" | "transfer";

const PAYMENT_METHODS: Array<{ value: string; label: string }> = [
  { value: "bkash", label: "bKash" },
  { value: "nagad", label: "Nagad" },
  { value: "rocket", label: "Rocket" },
  { value: "bank", label: "Bank" },
  { value: "card", label: "Card" },
  { value: "cash", label: "Cash" },
];

interface Props {
  orderId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the split persisted; receives the new order's id. */
  onSplitDone?: (newOrderId: string) => void;
}

/** Blank input = "allocate automatically"; anything else pins the new share. */
function parseShare(raw: string): number | undefined {
  const t = raw.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function parseAmount(raw: string): number {
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : 0;
}

export default function SplitOrderDialog({ orderId, open, onOpenChange, onSplitDone }: Props) {
  const { symbol } = useCurrency();

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [parent, setParent] = useState<SplitParentOrder | null>(null);
  const [items, setItems] = useState<SplitSourceItemRow[]>([]);
  const [payments, setPayments] = useState<SplitSourcePaymentRow[]>([]);

  // Item movement: itemId -> quantity to move (0 = stays).
  const [moveQty, setMoveQty] = useState<Record<string, number>>({});

  // New order payment — the three DISTINCT cases.
  const [payCase, setPayCase] = useState<PaymentCase>("cod");
  const [newMethod, setNewMethod] = useState("bkash");
  const [newAmount, setNewAmount] = useState("");
  const [newTrxId, setNewTrxId] = useState("");
  const [transferId, setTransferId] = useState("");
  const [transferAmount, setTransferAmount] = useState("");

  // Optional charge allocation: amounts assigned to the NEW order (blank =
  // proportional default; the original keeps the remainder).
  const [shareShipping, setShareShipping] = useState("");
  const [shareDiscount, setShareDiscount] = useState("");
  const [shareTax, setShareTax] = useState("");

  /* ─── Load the order's persisted rows on open ─── */
  useEffect(() => {
    if (!open || !orderId) return;
    let mounted = true;
    (async () => {
      setLoading(true);
      const [orderRes, itemsRes, payRes] = await Promise.all([
        supabase
          .from("orders")
          .select(
            "id, order_number, status, payment_status, payment_method, store_id, order_source_id, customer_id, customer_name, customer_phone, customer_address, customer_email, customer_city, fulfillment_type, subtotal, discount, shipping_cost, tax_amount, total",
          )
          .eq("id", orderId)
          .single(),
        supabase
          .from("order_items")
          .select("id, product_id, variation_id, product_name, quantity, unit_price, discount")
          .eq("order_id", orderId),
        supabase
          .from("order_payments")
          .select("id, method, amount, trx_id")
          .eq("order_id", orderId),
      ]);
      if (!mounted) return;
      if (orderRes.data) setParent(orderRes.data as unknown as SplitParentOrder);
      setItems(((itemsRes.data || []) as unknown as SplitSourceItemRow[]) || []);
      setPayments(((payRes.data || []) as unknown as SplitSourcePaymentRow[]) || []);
      // Reset the form for a fresh split.
      setMoveQty({});
      setPayCase("cod");
      setNewMethod("bkash");
      setNewAmount("");
      setNewTrxId("");
      setTransferId("");
      setTransferAmount("");
      setShareShipping("");
      setShareDiscount("");
      setShareTax("");
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [open, orderId]);

  /* ─── Plan inputs ─── */

  const source: SplitSourceOrder | null = useMemo(() => {
    if (!parent) return null;
    return {
      items: items.map((i) => ({
        id: i.id,
        productName: i.product_name,
        quantity: Number(i.quantity),
        unitPrice: Number(i.unit_price),
        lineDiscount: Number(i.discount || 0),
      })),
      payments: payments.map((p) => ({ id: p.id, method: p.method, amount: Number(p.amount) })),
      shipping: Number(parent.shipping_cost || 0),
      discount: Number(parent.discount || 0),
      // The order's tax is this app's single "other charge" (see orderMerge):
      // the plan allocates it per resulting order like any other charge.
      otherCharges: [{ id: SPLIT_TAX_CHARGE_ID, label: "Tax / VAT", amount: Number(parent.tax_amount || 0) }],
    };
  }, [parent, items, payments]);

  const request: SplitRequest = useMemo(() => {
    const movedItems = items
      .filter((i) => (moveQty[i.id] ?? 0) > 0)
      .map((i) => ({ itemId: i.id, quantity: moveQty[i.id] }));

    let newOrderPayment: SplitPaymentAssignment;
    if (payCase === "cod") {
      newOrderPayment = { kind: "cod" };
    } else if (payCase === "new-payment") {
      newOrderPayment = { kind: "new-payment", method: newMethod, amount: parseAmount(newAmount) };
    } else {
      newOrderPayment = { kind: "transfer", sourcePaymentId: transferId, amount: parseAmount(transferAmount) };
    }

    const shares: SplitChargeShares = {};
    let hasShares = false;
    const s = parseShare(shareShipping);
    if (s !== undefined) {
      shares.shipping = s;
      hasShares = true;
    }
    const d = parseShare(shareDiscount);
    if (d !== undefined) {
      shares.discount = d;
      hasShares = true;
    }
    const t = parseShare(shareTax);
    if (t !== undefined) {
      shares.otherCharges = { [SPLIT_TAX_CHARGE_ID]: t };
      hasShares = true;
    }

    return { movedItems, newOrderPayment, ...(hasShares ? { chargeShares: shares } : {}) };
  }, [items, moveQty, payCase, newMethod, newAmount, transferId, transferAmount, shareShipping, shareDiscount, shareTax]);

  /* ─── Live plan: warnings non-blocking; SplitPlanError only for invalid selections ─── */

  const { plan, planError } = useMemo((): { plan: SplitPlan | null; planError: SplitPlanError | null } => {
    if (!source || request.movedItems.length === 0) return { plan: null, planError: null };
    try {
      return { plan: computeSplitPlan(source, request), planError: null };
    } catch (e) {
      if (e instanceof SplitPlanError) return { plan: null, planError: e };
      throw e;
    }
  }, [source, request]);

  const recordedTotal = payments.reduce((s, p) => s + Number(p.amount), 0);

  /* ─── Persist ─── */

  const handleConfirm = async () => {
    if (!parent || !plan) return;
    setSubmitting(true);
    try {
      const result = await persistOrderSplit({
        parent,
        sourceItems: items,
        sourcePayments: payments,
        plan,
        assignment: request.newOrderPayment,
        newPaymentTrxId: newTrxId.trim() || null,
      });
      toast.success(`Order split — new order #${result.newOrderNumber} created`);
      onSplitDone?.(result.newOrderId);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Split failed: ${e?.message || String(e)}`);
    } finally {
      setSubmitting(false);
    }
  };

  /* ─── Render ─── */

  const money = (v: number) => `${symbol}${Number(v).toLocaleString()}`;
  const canConfirm = !!plan && !submitting;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={parent ? `Split Order — #${parent.order_number}` : "Split Order"}
      desktopMaxWidth="max-w-3xl"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm} className="gap-2">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scissors className="h-4 w-4" />}
            Split Order
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading order…
        </div>
      ) : !parent ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Could not load the order.</p>
      ) : (
        <div className="space-y-6">
          {/* ── Items to move ── */}
          <section>
            <h3 className="text-sm font-semibold text-foreground mb-1">Items to move</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Choose how many of each line move to the new order. Partial quantities are fine — at
              least one line must stay on the original.
            </p>
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-secondary text-xs text-muted-foreground">
                    <th className="text-left font-medium px-3 py-2">Product</th>
                    <th className="text-right font-medium px-3 py-2 w-24">Price</th>
                    <th className="text-center font-medium px-3 py-2 w-24">In order</th>
                    <th className="text-center font-medium px-3 py-2 w-28">Move qty</th>
                    <th className="text-right font-medium px-3 py-2 w-24">Moves</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const qty = moveQty[item.id] ?? 0;
                    return (
                      <tr key={item.id} className="border-t border-border">
                        <td className="px-3 py-2">
                          <div className="font-medium">{item.product_name}</div>
                          {Number(item.discount || 0) > 0 && (
                            <div className="text-xs text-muted-foreground">
                              line discount {money(item.discount || 0)}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">{money(item.unit_price)}</td>
                        <td className="px-3 py-2 text-center">{item.quantity}</td>
                        <td className="px-3 py-2 text-center">
                          <Input
                            type="number"
                            min={0}
                            max={item.quantity}
                            value={qty}
                            onChange={(e) => {
                              const v = Math.max(0, parseInt(e.target.value, 10) || 0);
                              setMoveQty((m) => ({ ...m, [item.id]: v }));
                            }}
                            className="w-16 h-8 text-center mx-auto text-sm"
                            aria-label={`Quantity of ${item.product_name} to move`}
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          {qty > 0 ? money(qty * Number(item.unit_price)) : <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── New order payment (three DISTINCT cases) ── */}
          <section>
            <h3 className="text-sm font-semibold text-foreground mb-1">New order payment</h3>
            <p className="text-xs text-muted-foreground mb-3">
              How is the new order paid? Money already recorded on this order is{" "}
              <strong>never duplicated</strong> — a transfer moves it.
            </p>

            <div className="space-y-2">
              {(
                [
                  { value: "cod" as const, title: "Cash on Delivery", desc: "No money moves — the new order is collected on delivery." },
                  { value: "new-payment" as const, title: "New payment", desc: "Collect a new payment now and record it on the new order only." },
                  { value: "transfer" as const, title: "Transfer an existing payment", desc: "Move part of this order's recorded payment to the new order — this order decreases by the transferred amount." },
                ]
              ).map((opt) => {
                const selected = payCase === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setPayCase(opt.value)}
                    aria-pressed={selected}
                    className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
                      selected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-secondary/50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-3.5 w-3.5 rounded-full border-2 shrink-0 ${
                          selected ? "border-primary bg-primary" : "border-muted-foreground/40"
                        }`}
                      />
                      <span className="text-sm font-medium">{opt.title}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 pl-5">{opt.desc}</p>
                  </button>
                );
              })}
            </div>

            {/* Case: new payment */}
            {payCase === "new-payment" && (
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Method</Label>
                  <Select value={newMethod} onValueChange={setNewMethod}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_METHODS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Amount ({symbol})</Label>
                  <Input
                    type="number"
                    min={0}
                    inputMode="decimal"
                    placeholder="0"
                    value={newAmount}
                    onChange={(e) => setNewAmount(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">TrxID (optional)</Label>
                  <Input value={newTrxId} onChange={(e) => setNewTrxId(e.target.value)} placeholder="—" />
                </div>
              </div>
            )}

            {/* Case: transfer */}
            {payCase === "transfer" && (
              <div className="mt-3 space-y-2">
                {payments.length === 0 ? (
                  <p className="text-xs text-amber-400">
                    This order has no recorded payments to transfer.
                  </p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Payment to transfer</Label>
                        <Select
                          value={transferId}
                          onValueChange={(v) => {
                            setTransferId(v);
                            const p = payments.find((x) => x.id === v);
                            if (p) setTransferAmount(String(p.amount));
                          }}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="Pick a recorded payment…" />
                          </SelectTrigger>
                          <SelectContent>
                            {payments.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.method} — {money(p.amount)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Amount to transfer ({symbol})</Label>
                        <Input
                          type="number"
                          min={0}
                          inputMode="decimal"
                          placeholder="0"
                          value={transferAmount}
                          onChange={(e) => setTransferAmount(e.target.value)}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Transfers above a payment's recorded amount are capped at that amount (money is
                      never duplicated) — you'll see a warning.
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Recorded payments on the original (issue #31: always visible) */}
            <div className="mt-4">
              <h4 className="text-xs font-semibold text-muted-foreground mb-1.5">
                Recorded payments on this order
              </h4>
              {payments.length === 0 ? (
                <p className="text-xs text-muted-foreground">No payments recorded yet.</p>
              ) : (
                <div className="rounded-lg border border-border divide-y divide-border">
                  {payments.map((p) => (
                    <div key={p.id} className="flex items-center justify-between px-3 py-1.5 text-sm">
                      <span>
                        {p.method}
                        {p.trx_id ? <span className="text-xs text-muted-foreground"> · {p.trx_id}</span> : null}
                      </span>
                      <span className="font-medium">{money(p.amount)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-3 py-1.5 text-sm bg-secondary/50">
                    <span className="text-xs text-muted-foreground">Recorded total</span>
                    <span className="font-medium">{money(recordedTotal)}</span>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* ── Optional charge allocation ── */}
          <section>
            <h3 className="text-sm font-semibold text-foreground mb-1">
              Charge allocation <span className="text-xs font-normal text-muted-foreground">(optional)</span>
            </h3>
            <p className="text-xs text-muted-foreground mb-3">
              Enter how much of each charge goes to the <strong>new</strong> order. Leave blank to
              split it automatically, proportional to each side's items. The original keeps the
              remainder — charges are split, never duplicated.
            </p>
            <div className="space-y-2">
              {Number(parent.shipping_cost || 0) > 0 && (
                <ChargeShareRow
                  label="Delivery charge"
                  sourceAmount={Number(parent.shipping_cost || 0)}
                  value={shareShipping}
                  onChange={setShareShipping}
                  symbol={symbol}
                />
              )}
              {Number(parent.discount || 0) > 0 && (
                <ChargeShareRow
                  label="Discount"
                  sourceAmount={Number(parent.discount || 0)}
                  value={shareDiscount}
                  onChange={setShareDiscount}
                  symbol={symbol}
                />
              )}
              {Number(parent.tax_amount || 0) > 0 && (
                <ChargeShareRow
                  label="Tax / VAT"
                  sourceAmount={Number(parent.tax_amount || 0)}
                  value={shareTax}
                  onChange={setShareTax}
                  symbol={symbol}
                />
              )}
              {Number(parent.shipping_cost || 0) <= 0 &&
                Number(parent.discount || 0) <= 0 &&
                Number(parent.tax_amount || 0) <= 0 && (
                  <p className="text-xs text-muted-foreground">This order has no charges to allocate.</p>
                )}
            </div>
          </section>

          {/* ── Live preview from the plan ── */}
          <section>
            <h3 className="text-sm font-semibold text-foreground mb-3">Preview</h3>

            {request.movedItems.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Select quantities above to preview both resulting orders.
              </p>
            ) : planError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive flex items-start gap-2">
                <Info className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{planError.message}</span>
              </div>
            ) : plan ? (
              <>
                {plan.warnings.length > 0 && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-400 mb-3 space-y-1">
                    <div className="flex items-center gap-1.5 font-semibold">
                      <AlertTriangle className="h-3.5 w-3.5" /> Warnings — review before continuing
                    </div>
                    {plan.warnings.map((w, i) => (
                      <div key={`${w.code}-${i}`}>• {w.message}</div>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <PlanOrderCard
                    title="Original order (keeps)"
                    order={plan.original}
                    money={money}
                    paymentNote="existing payments, adjusted for transfers"
                  />
                  <PlanOrderCard
                    title="New order"
                    order={plan.newOrder}
                    money={money}
                    paymentNote={
                      request.newOrderPayment.kind === "cod"
                        ? "cash on delivery — nothing assigned yet"
                        : request.newOrderPayment.kind === "new-payment"
                          ? "new payment collected"
                          : "transferred from the original"
                    }
                  />
                </div>
              </>
            ) : null}
          </section>
        </div>
      )}
    </ResponsiveDialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Small presentational helpers                                       */
/* ------------------------------------------------------------------ */

function ChargeShareRow({
  label,
  sourceAmount,
  value,
  onChange,
  symbol,
}: {
  label: string;
  sourceAmount: number;
  value: string;
  onChange: (v: string) => void;
  symbol: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <span className="text-sm">{label}</span>{" "}
        <span className="text-xs text-muted-foreground">(source {symbol}{sourceAmount.toLocaleString()})</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground whitespace-nowrap">New order gets</span>
        <Input
          type="number"
          min={0}
          inputMode="decimal"
          placeholder="auto"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-24 h-8 text-right text-sm"
          aria-label={`${label} share assigned to the new order`}
        />
      </div>
    </div>
  );
}

function PlanOrderCard({
  title,
  order,
  money,
  paymentNote,
}: {
  title: string;
  order: SplitPlanOrder;
  money: (v: number) => string;
  paymentNote: string;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold text-foreground">{title}</h4>
        <Badge variant="outline" className="text-[10px]">
          {order.items.reduce((s, i) => s + i.quantity, 0)} item(s)
        </Badge>
      </div>
      <dl className="space-y-1 text-xs">
        <Row label="Items" value={money(order.itemSubtotal)} />
        <Row label="Discount" value={`− ${money(order.discount)}`} />
        <Row label="Delivery" value={money(order.shipping)} />
        {order.otherCharges.map((c) => (
          <Row key={c.id} label={c.label} value={money(c.amount)} />
        ))}
        <div className="border-t border-border pt-1 mt-1 flex items-center justify-between">
          <dt className="font-semibold">Total</dt>
          <dd className="font-semibold">{money(order.total)}</dd>
        </div>
        <Row label="Paid" value={money(order.paid)} />
        <Row
          label="Due"
          value={money(order.due)}
          emphasize
        />
      </dl>
      <p className="text-[10px] text-muted-foreground mt-2">{paymentNote}</p>
    </div>
  );
}

function Row({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${emphasize ? "font-medium text-foreground" : ""}`}>
      <dt className={emphasize ? "" : "text-muted-foreground"}>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
