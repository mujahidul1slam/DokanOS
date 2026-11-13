export const CONNECTOR_ROLES = ["owner", "admin", "manager", "staff"] as const;
export type ConnectorRole = (typeof CONNECTOR_ROLES)[number];
export type ConnectorAction =
  | "create"
  | "view"
  | "update"
  | "disable"
  | "quarantine"
  | "rollback"
  | "rotate_secret"
  | "pause"
  | "resume";
export type ConnectorLifecycle =
  | "healthy"
  | "degraded"
  | "paused"
  | "disabled"
  | "quarantined"
  | "rolled_back";

export type ExternalStoreIdentity = { url: string; key: string };

/** Canonical identity used for duplicate protection; secrets/query strings are never identity data. */
export function normalizeExternalStoreIdentity(value: string): ExternalStoreIdentity {
  const input = value.trim();
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("invalid_external_store_url");
  }
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
    throw new Error("external_store_url_requires_https");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("external_store_url_must_not_contain_credentials_or_query");
  }
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return { url: url.toString().replace(/\/$/, ""), key: url.toString().replace(/\/$/, "") };
}

export function secretReferenceError(value: string): string | null {
  return /^[A-Z][A-Z0-9_]{2,127}$/.test(value) ? null : "invalid_secret_reference";
}

/** SHA-256 fingerprint for audit/comparison; the secret itself is never persisted or returned. */
export async function fingerprintManagedSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function connectorActionAllowed(role: string | null | undefined, _action: ConnectorAction): boolean {
  return role === "owner" || role === "admin";
}

const transitions: Record<string, Partial<Record<ConnectorAction, ConnectorLifecycle>>> = {
  disabled: { create: "healthy" },
  healthy: { disable: "disabled", pause: "paused", quarantine: "quarantined" },
  degraded: { disable: "disabled", pause: "paused", quarantine: "quarantined" },
  paused: { resume: "healthy", disable: "disabled", quarantine: "quarantined" },
  quarantined: { rollback: "rolled_back", disable: "disabled" },
  rolled_back: { disable: "disabled" },
};

export function transitionConnectorLifecycle(current: string, action: ConnectorAction): ConnectorLifecycle {
  const next = transitions[current]?.[action];
  if (!next) throw new Error("invalid_connector_lifecycle_transition");
  return next;
}

export type ConnectorBinding = {
  businessId: string;
  brandBusinessId: string | null;
  brandId: string;
  storeId: string;
  brandBoundStoreId: string | null;
  orderSourceBrandId: string | null;
  orderSourceType: string | null;
};

export function connectorBindingError(binding: ConnectorBinding): string | null {
  if (!binding.businessId || !binding.brandId || !binding.storeId) return "binding_required";
  if (binding.brandBusinessId !== binding.businessId) return "business_brand_mismatch";
  if (binding.brandBoundStoreId !== binding.storeId) return "store_brand_mismatch";
  if (binding.orderSourceBrandId !== binding.brandId) return "order_source_brand_mismatch";
  if (binding.orderSourceType !== "woocommerce") return "order_source_not_woocommerce";
  return null;
}
