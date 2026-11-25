export const WORK_STATES = [
  "pending",
  "leased",
  "retrying",
  "succeeded",
  "dead_letter",
  "quarantined",
  "cancelled",
  "replayed",
] as const;

export type WorkState = (typeof WORK_STATES)[number];
export type WorkFailureClass = "auth" | "rate_limit" | "server" | "transport" | "permanent" | "processing";

export type WorkFailureDecision = {
  state: "retrying" | "dead_letter" | "quarantined";
  errorClass: WorkFailureClass;
  retryable: boolean;
};

/** The attempt count supplied here is the count after the current lease claim. */
export function decideWorkFailure(
  status: number | null,
  attemptCount: number,
  maxAttempts: number,
): WorkFailureDecision {
  const errorClass: WorkFailureClass =
    status === 401 || status === 403 ? "auth" :
      status === 429 ? "rate_limit" :
        status !== null && status >= 500 ? "server" :
          status === null ? "transport" :
            status >= 400 ? "permanent" : "processing";
  const retryable = errorClass !== "permanent";
  return {
    state: !retryable ? "quarantined" : attemptCount >= Math.max(1, maxAttempts) ? "dead_letter" : "retrying",
    errorClass,
    retryable,
  };
}

/**
 * Contract mirror of the retry backoff in `finish_woocommerce_sync_work`
 * (2^least(attempt_count, 8) seconds x [0.75, 1.25], clamped to 1..900). The SQL
 * RPC is authoritative and the worker never computes a delay itself; this exists
 * so the schedule stays readable and testable in TypeScript, and
 * woocommerceWork.test.ts asserts the SQL expression still matches. The SQL
 * exponent is the raw attempt_count, so the clamp at 8 only diverges where both
 * sides are pinned to the 900s ceiling anyway.
 *
 * Deterministic jitter so a recorded delay can be pinned by a test; production
 * callers omit it and the SQL retry path applies its own random jitter.
 */
export function retryDelaySeconds(attemptCount: number, jitter = Math.random()): number {
  const attempt = Math.max(1, Math.min(8, Math.floor(attemptCount)));
  const boundedJitter = Math.max(0, Math.min(1, jitter));
  return Math.min(900, Math.max(1, Math.round(2 ** attempt * (0.75 + boundedJitter * 0.5))));
}

export function canHeartbeat(
  state: WorkState,
  owner: string | null | undefined,
  expectedOwner: string,
  leaseExpiresAt: Date | null | undefined,
  now = new Date(),
): boolean {
  return state === "leased" && owner === expectedOwner && !!leaseExpiresAt && leaseExpiresAt.getTime() > now.getTime();
}

export function canReplay(state: WorkState): boolean {
  return state === "dead_letter" || state === "quarantined";
}

export function correctionIdentity(originalWorkId: string, correctionId: string): string {
  return `correction:${originalWorkId}:${correctionId}`;
}
