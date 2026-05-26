
## Confirmed decisions

1. **Accrual** model for Net Sales (does not change when a due is paid later).
2. Returns reduce Net Sales on the **return date**.
3. AR aging buckets: **0–7 / 8–30 / 31–60 / 60+ days**.
4. Keep the **date-basis toggle** (Order date vs Payment date).

## Revamp summary (unchanged from previous plan)

Restructure `src/pages/PosReports.tsx` into 4 clearly-labelled sections:

1. **Sales (accrual, by order date)** — Gross, Discounts, Returns (by return date), Net Sales, Orders, AOV
2. **Cash Collected (by payment date)** — totals per method, with callout "Collected today against older orders: ৳X / N orders"
3. **Fulfillment** — count-only funnel: Walk-in done, Pickup pending, Delivery pending, Delivered, Cancelled, Returned
4. **Accounts Receivable** — Opening AR, + New credit, − Collections, Closing AR; aging 0–7 / 8–30 / 31–60 / 60+; list of outstanding orders with "Record payment"

Date-basis toggle controls labels + chart axis; each section internally uses its correct basis so numbers never lie.

Split into section components under `src/components/pos-reports/`. New queries: payments-in-range joined with parent orders (catches late collections on old orders); outstanding-balance orders across last 12 months for AR aging. No DB schema changes.

## New requirements (this round)

### A. Pickup-from-store orders: prompt for POS payment method when marking dues paid

**Where:** wherever an order's payment status flips to "paid" — primarily `OrderDetailSheet.tsx` and `DispatchDialog.tsx` mark-as-paid actions. Trigger condition: order has outstanding dues AND `fulfillment_type = 'pickup'` (also apply to `walkin` for symmetry when re-collecting later) AND payment is being collected now.

**Behavior:**
1. User clicks "Mark as paid" (or "Mark picked up & paid").
2. A `PayDuePaymentMethodDialog` opens, showing:
   - Outstanding amount (pre-filled, editable for partial)
   - Radio/select for payment method: Cash / bKash / Card / Bank (from same list POS uses)
   - Optional TRX ID (shown only for non-cash)
   - Optional notes
3. On confirm:
   - Insert a row in `order_payments` with `method`, `amount`, `trx_id`, `notes`.
   - If total paid ≥ order total, update `orders.payment_status = 'paid'`.
   - Insert `order_timeline` entry: "Due collected via {method} — ৳X by {user}".
   - The payment correctly attributes to the right method in Cash Collected reporting.

**Why this matters for reports:** today, dues paid later get attributed to the order's *original* `payment_method` via a heuristic. Forcing an explicit method makes the Cash Collected section exact.

### B. Home-delivery orders: auto-mark dues paid when Pathao delivers

**Where:** `supabase/functions/pathao-track/index.ts`, inside the block where Pathao status maps to `delivered`.

**Behavior:** when an order transitions to `delivered` via Pathao tracking AND has outstanding balance:
1. Compute outstanding = `total − Σ order_payments.amount`.
2. Insert an `order_payments` row:
   - `method = 'cod'` (Cash on Delivery — Pathao COD remittance)
   - `amount = outstanding`
   - `notes = 'Auto-collected on Pathao delivery (consignment {id})'`
3. Set `orders.payment_status = 'paid'`.
4. Insert `order_timeline` event: "Due cleared by Pathao COD delivery".
5. Skip step 2–4 if the order's `payment_method` already indicates fully prepaid online (i.e. no outstanding balance).

This means in reports:
- Sales section already counted the order on its original date (accrual — unchanged).
- Cash Collected section now shows that money on the delivery date under "COD" method.
- AR section correctly decreases.

**Edge case:** if user later disputes / Pathao returns the order, the existing `returned` mapping should reverse — add a `pos_returns`-style refund entry or back out the auto-payment. For v1, simply log a warning in the timeline; manual reversal by staff. (Confirm if you want auto-reversal too.)

### C. Add "COD" as a recognized payment method

Add `cod` to the methods list shown in the Cash Collected section and in the manual due-collection dialog. Display label: "Cash on Delivery (Pathao)". This is distinct from in-store "Cash" so reports show courier remittance separately from drawer cash.

## Technical notes for build phase

- New component: `src/components/orders/PayDuePaymentMethodDialog.tsx`
- Helper: `src/lib/dueCollection.ts` exporting `recordDuePayment({orderId, method, amount, trxId, notes})` — used by both the dialog and the Pathao auto-flow path (via edge function, which calls the same insert pattern directly in SQL since it can't import client helpers).
- Edge function update: `pathao-track/index.ts` adds a `recordCodPayment(orderId, amount, consignmentId)` helper using the service-role client.
- Reports page: `paymentBreakdown` now includes `cod` as a first-class method; no need for the heuristic "dues attributed to first payment method" — that logic gets removed once explicit collection is in place.
- No schema changes; everything fits existing `order_payments`, `orders.payment_status`, `order_timeline`.

## One thing to confirm

For Pathao `returned` / `delivery failed` after auto-COD-payment: do you want the system to **auto-reverse** the COD payment row, or just **flag it** in the timeline for manual staff action? (Default proposal: flag only, manual reversal — safer.)
