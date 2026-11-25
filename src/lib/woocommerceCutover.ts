import { WOO_ORDER_STATUSES, type WooOrderStatus } from "./woocommerceConnector.ts";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const STATUS_SET = new Set<string>(WOO_ORDER_STATUSES);

export type CutoverOrder = {
  id?: number;
  status: string;
  dateModified?: string;
  dateCreated?: string;
  total?: number;
  email?: string;
  name?: string;
  sku?: string;
  address?: string;
};

export type CutoverIdentity = {
  connectorId: string;
  externalOrderId: number;
  localOrderId: string;
};

export type CutoverWindow = {
  start: string;
  end: string;
  durationMs: number;
  contains(value: string | Date): boolean;
};

export type CutoverMatch =
  | { kind: "exact"; localOrderId: string }
  | { kind: "review"; candidates: string[]; signals: string[] }
  | { kind: "unmapped" };

export type BackfillFailure = {
  kind: "ambiguous" | "unsupported_status" | "incomplete" | "request_failed";
  externalOrderId?: number;
  detail: string;
};

export function describeWooExternalOrderId(value: unknown): string {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (typeof value === "string") return "string";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "non-finite number";
    if (!Number.isInteger(value)) return "fractional number";
    if (value <= 0) return "non-positive number";
    if (!Number.isSafeInteger(value)) return "unsafe integer";
  }
  return typeof value;
}

export function isValidWooExternalOrderId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export type BackfillItem = {
  externalOrderId?: number;
  status: string;
  match: CutoverMatch;
};

export type BackfillWrite = {
  kind: "import" | "refresh";
  connectorId: string;
  externalOrderId: number;
  status: WooOrderStatus;
};

export type BackfillPlan = {
  connectorId: string;
  window: CutoverWindow;
  dryRun: boolean;
  items: BackfillItem[];
  writes: BackfillWrite[];
  failures: BackfillFailure[];
};

export type CutoverEnqueueDecision = {
  work: boolean;
  failureClass: "unsupported_status" | null;
};

// The single decision point for whether a scanned Woo Order becomes a row in
// `woocommerce_sync_work`. A dry run never writes work: it only produces report
// items. Operator-review candidates are never auto-merged, so they are never
// enqueued either.
export function planCutoverEnqueue(input: {
  dryRun: boolean;
  matchKind: CutoverMatch["kind"];
  status: string;
}): CutoverEnqueueDecision {
  if (!STATUS_SET.has(input.status)) return { work: false, failureClass: "unsupported_status" };
  if (input.dryRun) return { work: false, failureClass: null };
  if (input.matchKind === "review") return { work: false, failureClass: null };
  return { work: true, failureClass: null };
}

function toDate(value: string | Date): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid cutover timestamp");
  return date;
}

export function buildCutoverWindow(watermark: string | Date): CutoverWindow {
  const endDate = toDate(watermark);
  const startDate = new Date(endDate.getTime() - SEVEN_DAYS_MS);
  const start = startDate.toISOString();
  const end = endDate.toISOString();
  return {
    start,
    end,
    durationMs: SEVEN_DAYS_MS,
    contains(value) {
      const timestamp = toDate(value).getTime();
      return timestamp >= startDate.getTime() && timestamp < endDate.getTime();
    },
  };
}

function normalized(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function fuzzySignals(remote: CutoverOrder, legacy: CutoverOrder): string[] {
  const signals: string[] = [];
  if (normalized(remote.email) && normalized(remote.email) === normalized(legacy.email)) signals.push("email");
  if (normalized(remote.name) && normalized(remote.name) === normalized(legacy.name)) signals.push("name");
  if (remote.total !== undefined && legacy.total !== undefined && remote.total === legacy.total) signals.push("total");
  if (normalized(remote.sku) && normalized(remote.sku) === normalized(legacy.sku)) signals.push("sku");
  if (normalized(remote.address) && normalized(remote.address) === normalized(legacy.address)) signals.push("address");
  if (remote.dateModified && legacy.dateModified) {
    const delta = Math.abs(toDate(remote.dateModified).getTime() - toDate(legacy.dateModified).getTime());
    if (delta <= 24 * 60 * 60 * 1000) signals.push("date");
  }
  return signals;
}

export function matchWooOrder(
  remote: CutoverOrder,
  connectorId: string,
  identities: readonly CutoverIdentity[],
  legacyOrders: readonly CutoverOrder[],
): CutoverMatch {
  if (isValidWooExternalOrderId(remote.id)) {
    const exact = identities.find(
      (identity) => identity.connectorId === connectorId && identity.externalOrderId === remote.id,
    );
    if (exact) return { kind: "exact", localOrderId: exact.localOrderId };
  }
  const candidates = legacyOrders
    .map((legacy, index) => ({ legacy, index, signals: fuzzySignals(remote, legacy) }))
    .filter((candidate) => candidate.signals.length >= 2);
  if (candidates.length > 0) {
    return {
      kind: "review",
      candidates: candidates.map((candidate) => candidate.legacy.id === undefined ? `legacy-${candidate.index}` : String(candidate.legacy.id)),
      signals: [...new Set(candidates.flatMap((candidate) => candidate.signals))],
    };
  }
  return { kind: "unmapped" };
}

export function createBackfillPlan(input: {
  connectorId: string;
  watermark: string | Date;
  dryRun: boolean;
  remoteOrders: readonly CutoverOrder[];
  identities: readonly CutoverIdentity[];
  legacyOrders: readonly CutoverOrder[];
}): BackfillPlan {
  const window = buildCutoverWindow(input.watermark);
  const failures: BackfillFailure[] = [];
  const items: BackfillItem[] = [];
  const writes: BackfillWrite[] = [];

  for (const legacy of input.legacyOrders) {
    const remote = input.remoteOrders.find((candidate) => fuzzySignals(candidate, legacy).length >= 2);
    if (remote && matchWooOrder(remote, input.connectorId, input.identities, [legacy]).kind === "review") {
      failures.push({ kind: "ambiguous", externalOrderId: remote.id, detail: "Legacy order has similarity signals but no provable external identity" });
    }
  }

  for (const remote of input.remoteOrders) {
    const match = matchWooOrder(remote, input.connectorId, input.identities, input.legacyOrders);
    items.push({ externalOrderId: remote.id, status: remote.status, match });
    if (!STATUS_SET.has(remote.status)) {
      failures.push({ kind: "unsupported_status", externalOrderId: remote.id, detail: `Unsupported WooCommerce status: ${remote.status}` });
      continue;
    }
    if (!isValidWooExternalOrderId(remote.id)) {
      failures.push({ kind: "incomplete", detail: "WooCommerce Order has no valid positive integer external ID" });
      continue;
    }
    if (input.dryRun) continue;
    if (match.kind === "review") {
      failures.push({ kind: "ambiguous", externalOrderId: remote.id, detail: "Fuzzy candidates require operator review" });
      continue;
    }
    // Approved policy: no plausible local match becomes a NEW local order only on
    // a real backfill. Fuzzy review candidates never reach this point, and a dry
    // run returned above, so an unmapped order is safe to import here.
    writes.push({
      kind: match.kind === "exact" ? "refresh" : "import",
      connectorId: input.connectorId,
      externalOrderId: remote.id,
      status: remote.status as WooOrderStatus,
    });
  }
  return { connectorId: input.connectorId, window, dryRun: input.dryRun, items, writes, failures };
}
