import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canHeartbeat,
  canReplay,
  correctionIdentity,
  decideWorkFailure,
  retryDelaySeconds,
} from "@/lib/woocommerceWork";

const SQL_FINISH_MIGRATION = "supabase/migrations/20261110090000_woocommerce_order_connector.sql";

describe("durable WooCommerce work decisions", () => {
  it("quarantines permanent API failures instead of retrying them", () => {
    expect(decideWorkFailure(404, 1, 8)).toEqual({
      state: "quarantined",
      errorClass: "permanent",
      retryable: false,
    });
  });

  it("dead-letters retryable work at the attempt boundary", () => {
    expect(decideWorkFailure(503, 8, 8).state).toBe("dead_letter");
    expect(decideWorkFailure(503, 7, 8).state).toBe("retrying");
    expect(decideWorkFailure(null, 8, 8).state).toBe("dead_letter");
  });

  it("uses bounded exponential retry delay", () => {
    expect(retryDelaySeconds(1, 0)).toBe(2);
    expect(retryDelaySeconds(8, 1)).toBe(320);
    expect(retryDelaySeconds(99, 0.5)).toBeLessThanOrEqual(900);
  });

  // The worker no longer computes a delay: finish_woocommerce_sync_work owns
  // next_attempt_at. These pin the documented contract so the schedule and the
  // SQL expression cannot drift silently.
  it("mirrors the SQL backoff contract of finish_woocommerce_sync_work", () => {
    const seconds = Array.from({ length: 8 }, (_, index) => retryDelaySeconds(index + 1, 0));
    expect(seconds).toEqual([2, 3, 6, 12, 24, 48, 96, 192]);
    // 2^5 seconds x [0.75, 1.25] is 24..40s; the 900s ceiling is never reached.
    expect(retryDelaySeconds(5, 0)).toBe(24);
    expect(retryDelaySeconds(5, 1)).toBe(40);
    for (const jitter of [0.1, 0.25, 0.5, 0.75]) {
      expect(retryDelaySeconds(5, jitter)).toBeGreaterThanOrEqual(24);
      expect(retryDelaySeconds(5, jitter)).toBeLessThanOrEqual(40);
    }
    expect(retryDelaySeconds(0, 0)).toBe(2);
    expect(retryDelaySeconds(1.9, 0)).toBe(2);
    expect(retryDelaySeconds(3, -5)).toBe(6);
    expect(retryDelaySeconds(3, 5)).toBe(10);
  });

  it("keeps the SQL next_attempt_at backoff identical to retryDelaySeconds", () => {
    const sql = readFileSync(SQL_FINISH_MIGRATION, "utf8");
    const body = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.finish_woocommerce_sync_work"));
    const backoff = body.slice(0, body.indexOf("END $$;"));
    expect(backoff).toContain("least(900::numeric, greatest(1::numeric, power(2::numeric, least(attempt_count, 8)) * (0.75 + random() * 0.5)))");
    expect(backoff).toContain("WHEN p_state = 'retrying' AND attempt_count < max_attempts");
  });

  it("classifies every WooCommerce status into the production error class", () => {
    const cases: Array<[number | null, string]> = [
      [null, "transport"],
      [401, "auth"],
      [403, "auth"],
      [404, "permanent"],
      [422, "permanent"],
      [429, "rate_limit"],
      [500, "server"],
      [503, "server"],
      [200, "processing"],
    ];
    for (const [status, errorClass] of cases) {
      expect(decideWorkFailure(status, 1, 8).errorClass, String(status)).toBe(errorClass);
    }
  });

  it("keeps rate limits, auth failures and server errors retryable", () => {
    for (const status of [401, 403, 429, 500, null]) {
      const decision = decideWorkFailure(status, 1, 8);
      expect(decision.retryable, String(status)).toBe(true);
      expect(decision.state, String(status)).toBe("retrying");
      expect(decideWorkFailure(status, 8, 8).state, String(status)).toBe("dead_letter");
    }
    for (const status of [400, 404, 409, 422]) {
      expect(decideWorkFailure(status, 1, 8)).toEqual({
        state: "quarantined",
        errorClass: "permanent",
        retryable: false,
      });
    }
  });

  it("treats a non-positive attempt budget as one attempt", () => {
    expect(decideWorkFailure(503, 1, 0).state).toBe("dead_letter");
    expect(decideWorkFailure(503, 2, -3).state).toBe("dead_letter");
  });

  it("only heartbeats an owned, unexpired lease", () => {
    const now = new Date("2026-11-10T00:00:00Z");
    expect(canHeartbeat("leased", "worker-a", "worker-a", new Date("2026-11-10T00:01:00Z"), now)).toBe(true);
    expect(canHeartbeat("leased", "worker-b", "worker-a", new Date("2026-11-10T00:01:00Z"), now)).toBe(false);
    expect(canHeartbeat("leased", "worker-a", "worker-a", new Date("2026-11-09T23:59:00Z"), now)).toBe(false);
    expect(canHeartbeat("retrying", "worker-a", "worker-a", new Date("2026-11-10T00:01:00Z"), now)).toBe(false);
  });

  it("allows replay only from operator terminal states and namespaces corrections", () => {
    expect(canReplay("dead_letter")).toBe(true);
    expect(canReplay("quarantined")).toBe(true);
    expect(canReplay("succeeded")).toBe(false);
    expect(correctionIdentity("work-1", "fix-2")).toBe("correction:work-1:fix-2");
  });
});
