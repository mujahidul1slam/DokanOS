/**
 * Order money is not always derivable from the line items.
 *
 * A WooCommerce order can carry its value in fees or tax rather than in
 * products — a delivery fee, a service charge, a VAT line. The importer keeps
 * the order's `total` but stores no `order_items` for those charges, so an
 * order that reads ৳1 in the list would read ৳0 the moment the detail sheet
 * rebuilt the total from its (empty) item list and saved it back.
 *
 * The rule here: the stored money is the source of truth unless the person
 * actually changed the items. Only a deliberate item edit lets the item list
 * decide the money again — which is what makes "remove every line" still work.
 */
export interface OrderTotalsInput {
  items: Array<{ quantity: number; unit_price: number }>;
  discount: number;
  shippingCost: number;
  taxAmount: number;
  storedSubtotal: number | null | undefined;
  storedTotal: number | null | undefined;
  /** True only when the items were added, removed, re-priced or re-quantified. */
  itemsTouched: boolean;
}

export interface OrderTotals {
  subtotal: number;
  total: number;
}

const money = (value: number | null | undefined): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export function computeOrderTotals(input: OrderTotalsInput): OrderTotals {
  const itemsSubtotal = input.items.reduce(
    (sum, item) => sum + money(item.quantity) * money(item.unit_price),
    0,
  );

  // An untouched order keeps the money it was imported with, even when that
  // money is not represented by any line item.
  const subtotal = input.itemsTouched ? itemsSubtotal : money(input.storedSubtotal);

  const total =
    subtotal - money(input.discount) + money(input.shippingCost) + money(input.taxAmount);

  return { subtotal, total };
}
