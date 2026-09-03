// Revamp Phase 2.2: the courier-agnostic adapter contract.
//
// One file per courier implements this interface; the dispatch/tracking core
// (pathao-courier function today, the queue router in sync-worker) talks ONLY
// to this interface. Pathao is the reference implementation
// (adapters/pathao.ts); courier #2 (Steadfast/RedX/eCourier) lands as another
// file without touching the core.
//
// Canonical statuses (Phase 2 spec):
//   pending | picked_up | in_transit | out_for_delivery | delivered |
//   returned | cancelled | on_hold | lost

export type CanonicalStatus =
  | "pending"
  | "picked_up"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "returned"
  | "cancelled"
  | "on_hold"
  | "lost";

export interface CourierToken {
  token: string;
  expiresAt: number; // epoch ms
}

/** Credentials as stored per-integration (adapter defines the shape). */
export interface CourierIntegration {
  id: string;             // DB uuid, or "env" for env-var creds
  provider: string;
  credentials: Record<string, string>;
}

export interface CourierStore {
  id: string;
  name: string;
  address?: string | null;
  raw?: unknown;
}

export interface ParcelRequest {
  orderId: string;         // DokanOS order uuid (for idempotency + linkage)
  storeIdAtCourier?: string | number | null; // merchant's store id at the courier
  recipientName: string;
  recipientPhone: string;
  address: string;
  city?: string | null;
  zone?: string | null;
  area?: string | null;
  amountToCollect: number; // COD amount (0 = no collection)
  weight?: number | null;
  itemCount?: number;
  note?: string | null;
  raw?: unknown;           // adapter-specific passthrough fields
}

export interface ParcelResult {
  orderId: string;
  consignmentId: string;
  skipped?: boolean;       // idempotent skip: order already has a parcel
  reason?: string;
  raw?: unknown;
}

export interface TrackedStatus {
  consignmentId: string;
  rawStatus: string;
  canonicalStatus: CanonicalStatus;
}

export interface CourierAdapter {
  /** Provider code matching courier_providers.code. */
  readonly code: string;

  /** Human label for timeline/audit text. */
  readonly label: string;

  /** 2.4: polling cadence + request budget (mirrors courier_providers row). */
  readonly rateLimit: { maxPerMinute: number; trackIntervalMinutes: number };

  /** DB-cached token (courier_tokens table, revamp 1.2). */
  authenticate(integration: CourierIntegration): Promise<CourierToken>;

  listMerchantStores(integration: CourierIntegration): Promise<CourierStore[]>;

  /** Must be idempotent: an order with an existing consignment skips. */
  createParcels(
    integration: CourierIntegration,
    parcels: ParcelRequest[],
  ): Promise<Array<ParcelResult | (ParcelResult & { error: string })>>;

  trackParcels(
    integration: CourierIntegration,
    consignments: string[],
  ): Promise<Array<TrackedStatus | (TrackedStatus & { error: string })>>;

  cancelParcel(
    integration: CourierIntegration,
    consignmentId: string,
  ): Promise<{ cancelled: boolean; raw?: unknown; error?: string }>;

  /** Refresh the adapter's location store (pathao_cities/zones/areas tables). */
  refreshLocations(
    integration: CourierIntegration,
  ): Promise<{ cities?: number; zones?: number; areas?: number }>;

  /** Map a raw courier status string to a canonical status. */
  mapStatus(raw: string | null | undefined): CanonicalStatus | undefined;
}
