import { useBrand } from "../BrandContext";
import { fmtCurrency } from "./brand";

/**
 * Currency-aware price formatter bound to the active storefront.
 * Usage:  const fmt = useCurrency();  ...  {fmt(product.price)}
 */
export function useCurrency() {
  const { storefront } = useBrand();
  const currency = storefront.currency || "BDT";
  return (n: number) => fmtCurrency(n, currency);
}