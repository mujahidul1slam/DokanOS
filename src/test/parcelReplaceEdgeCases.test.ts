import { describe, expect, it } from "vitest";
import {
  isPathaoCancellationFailure,
  unwrapPathaoPayload,
} from "@/components/orders/AttachParcelDialog";

describe("parcel replace client edge cases", () => {
  it("unwraps the edge-function { data: result } envelope", () => {
    const result = { pathao_failed: true, reason: "already delivered" };
    expect(unwrapPathaoPayload({ data: result })).toEqual(result);
    expect(isPathaoCancellationFailure({ data: result })).toBe(true);
  });

  it("also accepts a direct result payload from Supabase", () => {
    expect(isPathaoCancellationFailure({ pathao_failed: true })).toBe(true);
    expect(isPathaoCancellationFailure({ data: { pathao_failed: false } })).toBe(false);
    expect(isPathaoCancellationFailure(null)).toBe(false);
  });

  it("does not mistake ordinary attach results for a cancellation failure", () => {
    expect(unwrapPathaoPayload({ data: { consignment_id: "DT123", tracking_status: "Picked" } }))
      .toEqual({ consignment_id: "DT123", tracking_status: "Picked" });
    expect(isPathaoCancellationFailure({ data: { consignment_id: "DT123" } })).toBe(false);
  });
});

// Acceptance checklist covered by the DispatchDialog flow:
// - skip leaves the order untouched by excluding it from toDispatch;
// - replace sends one replace payload per selected existing order;
// - existing-entry confirmation is shown before booking;
// - cancellation-failure envelopes trigger the force-overwrite dialog;
// - cancelled booking -> not-Entered is owned by the edge function (wiring note).
