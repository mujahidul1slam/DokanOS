/**
 * Task 9 (domain revamp, spec §4): business-level courier services.
 *
 * One courier account per business (Pathao, Steadfast, RedX, eCourier…),
 * enabled at fulfillment time — never per brand. `credentials` is
 * provider-specific and write-only in the UI (never echoed back in plaintext).
 *
 * Legacy courier rows (`pathao_integrations`, `courier_integrations`, courier
 * `connectors`) are mapped in via the `legacy_*` audit columns at cutover and
 * dropped at contract time (Task 16).
 */

export type CourierProviderCode = "pathao" | "steadfast" | "redx" | "ecourier";

export interface CourierCredentialField {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
}

export interface CourierProviderInfo {
  code: CourierProviderCode;
  label: string;
  /** Which dispatch adapter is wired today (Pathao only — spec §4 ships them one by one). */
  dispatchSupported: boolean;
  fields: CourierCredentialField[];
}

export const COURIER_PROVIDERS: readonly CourierProviderInfo[] = [
  {
    code: "pathao",
    label: "Pathao",
    dispatchSupported: true,
    fields: [
      { key: "client_id", label: "Client ID", placeholder: "…", secret: true },
      { key: "client_secret", label: "Client secret", placeholder: "…", secret: true },
      { key: "username", label: "Account username" },
      { key: "password", label: "Account password", secret: true },
    ],
  },
  {
    code: "steadfast",
    label: "Steadfast",
    dispatchSupported: false,
    fields: [
      { key: "api_key", label: "API key", secret: true },
      { key: "secret_key", label: "Secret key", secret: true },
    ],
  },
  {
    code: "redx",
    label: "RedX",
    dispatchSupported: false,
    fields: [{ key: "api_key", label: "API key", secret: true }],
  },
  {
    code: "ecourier",
    label: "eCourier",
    dispatchSupported: false,
    fields: [{ key: "api_key", label: "API key", secret: true }],
  },
];

const PROVIDER_MAP: Record<string, CourierProviderInfo> = Object.fromEntries(
  COURIER_PROVIDERS.map((p) => [p.code, p]),
);

export function courierProviderInfo(code: string): CourierProviderInfo | undefined {
  return PROVIDER_MAP[code];
}

export function courierProviderLabel(code: string): string {
  return PROVIDER_MAP[code]?.label ?? code;
}

export interface CourierServiceRow {
  id: string;
  business_id: string;
  provider: string;
  name: string;
  credentials: Record<string, unknown> | null;
  is_active: boolean;
  legacy_pathao_integration_id: string | null;
  legacy_courier_integration_id: string | null;
  legacy_connector_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Display state for a service: inactive, configured (all credential fields
 * present), or still needing setup. Credentials are stored but never rendered.
 */
export function courierServiceState(
  service: Pick<CourierServiceRow, "provider" | "credentials" | "is_active">,
): "inactive" | "configured" | "needs_setup" {
  if (!service.is_active) return "inactive";
  const fields = courierProviderInfo(service.provider)?.fields ?? [];
  const credentials = service.credentials ?? {};
  const configured = fields.every((f) => {
    const value = credentials[f.key];
    return typeof value === "string" && value.trim().length > 0;
  });
  return configured ? "configured" : "needs_setup";
}

/** The legacy Pathao integration id to hand the dispatch adapter pre-cutover. */
export function courierServiceIntegrationId(service: CourierServiceRow): string | null {
  return service.legacy_pathao_integration_id ?? null;
}
