export type OrderFulfillment = "walkin" | "pickup" | "delivery";

export interface OrderCustomerValidationInput {
  name?: string | null;
  phone?: string | null;
  address?: string | null;
  fulfillment: OrderFulfillment;
  cityId?: number | null;
  zoneId?: number | null;
}

/** Normalize a Bangladesh mobile number to the local 11-digit format. */
export function normalizeBdPhone(raw?: string | null): string | null {
  if (!raw) return null;

  const value = String(raw).trim();
  if (!/^[+\d\s().\-০-৯]+$/.test(value)) return null;

  const englishDigits = value.replace(/[০-৯]/g, (digit) => String("০১২৩৪৫৬৭৮৯".indexOf(digit)));
  let digits = englishDigits.replace(/\D/g, "");

  if (digits.startsWith("880") && digits.length === 13) digits = digits.slice(3);
  if (digits.length === 10 && digits.startsWith("1")) digits = `0${digits}`;

  return /^01[3-9]\d{8}$/.test(digits) ? digits : null;
}

/** Return the first customer or delivery error, or null when the form is valid. */
export function validateOrderCustomerInfo(input: OrderCustomerValidationInput): string | null {
  if (!input.name?.trim()) return "Enter the customer name.";
  if (!normalizeBdPhone(input.phone)) {
    return "Enter a valid Bangladesh mobile number (for example, 01712345678).";
  }

  if (input.fulfillment !== "delivery") return null;
  if (!input.address?.trim()) return "Enter the delivery address.";
  if (input.cityId == null) return "Select a delivery city.";
  if (input.zoneId == null) return "Select a delivery zone.";

  return null;
}
