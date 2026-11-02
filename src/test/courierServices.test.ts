import { describe, expect, it } from "vitest";
import {
  COURIER_PROVIDERS,
  courierProviderInfo,
  courierProviderLabel,
  courierServiceIntegrationId,
  courierServiceState,
  type CourierServiceRow,
} from "@/lib/courierServices";

const service = (over: Partial<CourierServiceRow> = {}): CourierServiceRow => ({
  id: "s1",
  business_id: "b1",
  provider: "pathao",
  name: "Main Pathao",
  credentials: {},
  is_active: true,
  legacy_pathao_integration_id: null,
  legacy_courier_integration_id: null,
  legacy_connector_id: null,
  created_at: "",
  updated_at: "",
  ...over,
});

describe("courier services (spec §4)", () => {
  it("covers the spec's named providers with credential fields", () => {
    expect(COURIER_PROVIDERS.map((p) => p.code).sort()).toEqual([
      "ecourier",
      "pathao",
      "redx",
      "steadfast",
    ]);
    for (const provider of COURIER_PROVIDERS) {
      expect(provider.fields.length).toBeGreaterThan(0);
    }
    expect(courierProviderLabel("steadfast")).toBe("Steadfast");
    expect(courierProviderLabel("unknown")).toBe("unknown");
    expect(courierProviderInfo("nope")).toBeUndefined();
  });

  it("only Pathao has a dispatch adapter wired today", () => {
    expect(COURIER_PROVIDERS.filter((p) => p.dispatchSupported).map((p) => p.code)).toEqual(["pathao"]);
  });

  it("derives display state without ever exposing credentials", () => {
    expect(courierServiceState({ provider: "pathao", credentials: null, is_active: false })).toBe("inactive");
    expect(courierServiceState({ provider: "pathao", credentials: {}, is_active: true })).toBe("needs_setup");
    expect(
      courierServiceState({
        provider: "pathao",
        credentials: { client_id: "a", client_secret: "b", username: "u", password: "p" },
        is_active: true,
      }),
    ).toBe("configured");
    expect(
      courierServiceState({ provider: "redx", credentials: { api_key: "k" }, is_active: true }),
    ).toBe("configured");
  });

  it("resolves the legacy integration id for the pre-cutover dispatch path", () => {
    expect(courierServiceIntegrationId(service())).toBeNull();
    expect(
      courierServiceIntegrationId(service({ legacy_pathao_integration_id: "1931698d-0000-4000-8000-000000000000" })),
    ).toBe("1931698d-0000-4000-8000-000000000000");
  });
});
