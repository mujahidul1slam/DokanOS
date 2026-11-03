import { describe, expect, it } from "vitest";
import { normalizeBdPhone, validateOrderCustomerInfo } from "@/lib/orderValidation";

describe("order customer validation", () => {
  it("normalizes accepted Bangladesh mobile formats", () => {
    expect(normalizeBdPhone("01712-345678")).toBe("01712345678");
    expect(normalizeBdPhone("+880 1712 345678")).toBe("01712345678");
    expect(normalizeBdPhone("০১৭১২৩৪৫৬৭৮")).toBe("01712345678");
  });

  it("rejects non-Bangladesh or malformed mobile numbers", () => {
    expect(normalizeBdPhone("0181234567")).toBeNull();
    expect(normalizeBdPhone("01212345678")).toBeNull();
    expect(normalizeBdPhone("017123456789")).toBeNull();
    expect(normalizeBdPhone("not-a-phone-01712345678")).toBeNull();
  });

  it("requires name and phone for every fulfillment", () => {
    expect(validateOrderCustomerInfo({ fulfillment: "walkin", name: "", phone: "01712345678" })).toBe("Enter the customer name.");
    expect(validateOrderCustomerInfo({ fulfillment: "pickup", name: "A", phone: "0171234567" })).toContain("valid Bangladesh");
  });

  it("requires delivery address, city, and zone for delivery", () => {
    const base = { fulfillment: "delivery" as const, name: "A", phone: "01712345678" };
    expect(validateOrderCustomerInfo(base)).toBe("Enter the delivery address.");
    expect(validateOrderCustomerInfo({ ...base, address: "Road 1" })).toBe("Select a delivery city.");
    expect(validateOrderCustomerInfo({ ...base, address: "Road 1", cityId: 1 })).toBe("Select a delivery zone.");
    expect(validateOrderCustomerInfo({ ...base, address: "Road 1", cityId: 1, zoneId: 2 })).toBeNull();
  });
});
