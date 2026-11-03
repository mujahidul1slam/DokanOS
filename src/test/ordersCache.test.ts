import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ORDERS_CACHE_MAX_AGE_MS,
  dedupeFetch,
  invalidateOrdersCache,
  makeOrdersScopeKey,
  ordersContextSessionToken,
  readLatestOrdersCache,
  readOrdersCache,
  writeOrdersCache,
} from "@/lib/ordersCache";

/**
 * Unit tests for the Orders stale-while-revalidate cache (issue #9 follow-up).
 *
 * These cover the module's contract only — no React, no Supabase. The hook's
 * integration (paint cached rows first, then revalidate) is exercised in
 * src/test/useOrdersData.test.tsx.
 */

interface Payload {
  orders: string[];
}

const KEY = makeOrdersScopeKey(["store-1", "store-2"], { businessId: "biz-1" });

beforeEach(() => {
  // The cache is module-level state shared by every test in this file.
  invalidateOrdersCache();
});

describe("readOrdersCache / writeOrdersCache", () => {
  it("misses when nothing was ever written", () => {
    expect(readOrdersCache<Payload>(KEY)).toBeNull();
  });

  it("returns the cached payload synchronously, with its age", () => {
    writeOrdersCache<Payload>(KEY, { orders: ["a", "b"] });

    const hit = readOrdersCache<Payload>(KEY);
    expect(hit).not.toBeNull();
    expect(hit?.payload).toEqual({ orders: ["a", "b"] });
    expect(hit?.ageMs).toBe(0);
    expect(hit?.timestamp).toBeGreaterThan(0);
  });

  it("paints a cache hit without invoking the fetcher", async () => {
    writeOrdersCache<Payload>(KEY, { orders: ["cached"] });

    const fetcher = vi.fn(async () => ({ orders: ["fresh"] }));

    // The hook's read-through: paint what the cache has...
    const hit = readOrdersCache<Payload>(KEY);
    expect(hit?.payload).toEqual({ orders: ["cached"] });

    // ...then revalidate. The fetcher is deferred to a microtask, so nothing
    // runs before the cached rows have been handed to React.
    const revalidation = dedupeFetch(KEY, fetcher);
    expect(fetcher).not.toHaveBeenCalled();

    await revalidation;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps the last good payload when a newer write has a different shape", () => {
    writeOrdersCache<Payload>(KEY, { orders: ["kept"] });
    expect(readOrdersCache<Payload>(KEY)?.payload).toEqual({ orders: ["kept"] });
  });
});

describe("dedupeFetch", () => {
  it("fetches once on a miss and lets the caller cache the result", async () => {
    const fetcher = vi.fn(async () => ({ orders: ["a"] }));

    expect(readOrdersCache<Payload>(KEY)).toBeNull();
    const payload = await dedupeFetch<Payload>(KEY, fetcher);
    expect(payload).toEqual({ orders: ["a"] });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Once committed, the same key reads back without another fetch.
    writeOrdersCache<Payload>(KEY, payload);
    expect(readOrdersCache<Payload>(KEY)?.payload).toEqual(payload);

    await dedupeFetch<Payload>(KEY, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight request between concurrent identical calls", async () => {
    let release!: (payload: Payload) => void;
    const gate = new Promise<Payload>((resolve) => {
      release = resolve;
    });
    const fetcher = vi.fn(() => gate);

    const first = dedupeFetch<Payload>(KEY, fetcher);
    const second = dedupeFetch<Payload>(KEY, fetcher);

    expect(second).toBe(first);
    release({ orders: ["shared"] });
    await expect(first).resolves.toEqual({ orders: ["shared"] });
    await expect(second).resolves.toEqual({ orders: ["shared"] });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not share requests across different keys", async () => {
    const otherKey = makeOrdersScopeKey(["store-9"], { businessId: "biz-1" });
    const fetcher = vi.fn(async () => ({ orders: ["a"] }));

    await Promise.all([
      dedupeFetch<Payload>(KEY, fetcher),
      dedupeFetch<Payload>(otherKey, fetcher),
    ]);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("allows a fresh fetch after the previous one settled", async () => {
    const fetcher = vi.fn(async () => ({ orders: ["a"] }));

    await dedupeFetch<Payload>(KEY, fetcher);
    await dedupeFetch<Payload>(KEY, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("turns a synchronous fetcher throw into a rejection instead of escaping", async () => {
    const fetcher = vi.fn(() => {
      throw new Error("sync boom");
    });

    await expect(dedupeFetch<Payload>(KEY, fetcher)).rejects.toThrow("sync boom");
    expect(readOrdersCache<Payload>(KEY)).toBeNull();
  });
});

describe("invalidation", () => {
  it("clears one key without touching the others", () => {
    const otherKey = makeOrdersScopeKey(["store-9"], { businessId: "biz-1" });
    writeOrdersCache<Payload>(KEY, { orders: ["a"] });
    writeOrdersCache<Payload>(otherKey, { orders: ["b"] });

    invalidateOrdersCache(KEY);

    expect(readOrdersCache<Payload>(KEY)).toBeNull();
    expect(readOrdersCache<Payload>(otherKey)?.payload).toEqual({ orders: ["b"] });
  });

  it("clears every key when called without an argument", () => {
    const otherKey = makeOrdersScopeKey(["store-9"], { businessId: "biz-1" });
    writeOrdersCache<Payload>(KEY, { orders: ["a"] });
    writeOrdersCache<Payload>(otherKey, { orders: ["b"] });

    invalidateOrdersCache();

    expect(readOrdersCache<Payload>(KEY)).toBeNull();
    expect(readOrdersCache<Payload>(otherKey)).toBeNull();
  });
});

describe("expiry", () => {
  it("ignores an entry older than the max age", () => {
    writeOrdersCache<Payload>(KEY, { orders: ["stale"] }, Date.now() - ORDERS_CACHE_MAX_AGE_MS - 1);

    expect(readOrdersCache<Payload>(KEY)).toBeNull();
    // The expired record is dropped, so nothing stale can be painted later.
    expect(readOrdersCache<Payload>(KEY)).toBeNull();
  });

  it("refetches after the cached entry expired", async () => {
    writeOrdersCache<Payload>(KEY, { orders: ["stale"] }, Date.now() - ORDERS_CACHE_MAX_AGE_MS - 1);
    expect(readOrdersCache<Payload>(KEY)).toBeNull();

    const fetcher = vi.fn(async () => ({ orders: ["fresh"] }));
    await expect(dedupeFetch<Payload>(KEY, fetcher)).resolves.toEqual({ orders: ["fresh"] });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("honours a caller-supplied max age", () => {
    writeOrdersCache<Payload>(KEY, { orders: ["a"] }, Date.now() - 1_000);

    expect(readOrdersCache<Payload>(KEY, 5_000)?.payload).toEqual({ orders: ["a"] });
    expect(readOrdersCache<Payload>(KEY, 500)).toBeNull();
  });
});

describe("failed revalidation", () => {
  it("does not leave a payload-less entry behind that blocks the next fetch", async () => {
    const failing = vi.fn(async () => {
      throw new Error("network down");
    });

    await expect(dedupeFetch<Payload>(KEY, failing)).rejects.toThrow("network down");
    expect(readOrdersCache<Payload>(KEY)).toBeNull();

    const recovering = vi.fn(async () => ({ orders: ["recovered"] }));
    await expect(dedupeFetch<Payload>(KEY, recovering)).resolves.toEqual({
      orders: ["recovered"],
    });
    expect(recovering).toHaveBeenCalledTimes(1);
  });

  it("keeps the last good payload readable after a failed refresh", async () => {
    writeOrdersCache<Payload>(KEY, { orders: ["last-good"] });
    const failing = vi.fn(async () => {
      throw new Error("boom");
    });

    await expect(dedupeFetch<Payload>(KEY, failing)).rejects.toThrow("boom");

    expect(readOrdersCache<Payload>(KEY)?.payload).toEqual({ orders: ["last-good"] });
  });
});

describe("readLatestOrdersCache", () => {
  it("returns the freshest payload for a business + context, whatever the scope", () => {
    const olderKey = makeOrdersScopeKey(["store-1"], {
      businessId: "biz-1",
      sessionScope: "ctx-a",
    });
    const newerKey = makeOrdersScopeKey(["store-1", "store-2"], {
      businessId: "biz-1",
      sessionScope: "ctx-a",
      orderSourceIds: ["src-1"],
    });

    writeOrdersCache<Payload>(olderKey, { orders: ["older"] }, Date.now() - 30_000);
    writeOrdersCache<Payload>(newerKey, { orders: ["newest"] }, Date.now() - 1_000);

    expect(readLatestOrdersCache<Payload>("biz-1", "ctx-a")?.payload).toEqual({
      orders: ["newest"],
    });
  });

  it("never crosses businesses or context sessions", () => {
    writeOrdersCache<Payload>(
      makeOrdersScopeKey(["s1"], { businessId: "biz-1", sessionScope: "ctx-a" }),
      { orders: ["mine"] },
    );
    writeOrdersCache<Payload>(
      makeOrdersScopeKey(["s1"], { businessId: "biz-2", sessionScope: "ctx-a" }),
      { orders: ["other-business"] },
    );
    writeOrdersCache<Payload>(
      makeOrdersScopeKey(["s1"], { businessId: "biz-1", sessionScope: "ctx-b" }),
      { orders: ["other-session"] },
    );

    expect(readLatestOrdersCache<Payload>("biz-1", "ctx-a")?.payload).toEqual({
      orders: ["mine"],
    });
    expect(readLatestOrdersCache<Payload>("biz-2", "ctx-a")?.payload).toEqual({
      orders: ["other-business"],
    });
    expect(readLatestOrdersCache<Payload>("biz-3", "ctx-a")).toBeNull();
    expect(readLatestOrdersCache<Payload>("biz-1", "ctx-c")).toBeNull();
  });

  it("ignores expired entries and requires a business id", () => {
    writeOrdersCache<Payload>(
      makeOrdersScopeKey(["s1"], { businessId: "biz-1", sessionScope: "ctx-a" }),
      { orders: ["stale"] },
      Date.now() - ORDERS_CACHE_MAX_AGE_MS - 1,
    );

    expect(readLatestOrdersCache<Payload>("biz-1", "ctx-a")).toBeNull();
    expect(readLatestOrdersCache<Payload>("biz-1", "ctx-a", 60_000)).toBeNull();
    expect(readLatestOrdersCache<Payload>(null, "ctx-a")).toBeNull();
    expect(readLatestOrdersCache<Payload>("", "ctx-a")).toBeNull();
  });

  it("honours a caller-supplied max age", () => {
    writeOrdersCache<Payload>(
      makeOrdersScopeKey(["s1"], { businessId: "biz-1", sessionScope: "ctx-a" }),
      { orders: ["recent"] },
      Date.now() - 1_000,
    );

    expect(readLatestOrdersCache<Payload>("biz-1", "ctx-a", 5_000)?.payload).toEqual({
      orders: ["recent"],
    });
    expect(readLatestOrdersCache<Payload>("biz-1", "ctx-a", 500)).toBeNull();
  });

  it("matches exactly the token the hook derives for one mounted context", () => {
    const context = { id: "biz-1" };
    const token = ordersContextSessionToken(context);
    writeOrdersCache<Payload>(
      makeOrdersScopeKey(["s1"], { businessId: "biz-1", sessionScope: token }),
      { orders: ["hook-scope"] },
    );

    expect(readLatestOrdersCache<Payload>("biz-1", token)?.payload).toEqual({
      orders: ["hook-scope"],
    });
    // A different context instance (a new session) sees nothing.
    expect(
      readLatestOrdersCache<Payload>("biz-1", ordersContextSessionToken({ id: "biz-1" })),
    ).toBeNull();
  });
});

describe("makeOrdersScopeKey", () => {
  it("is canonical across ordering, duplicates and whitespace", () => {
    const a = makeOrdersScopeKey([" store-2", "store-1", "store-2 "], { businessId: "biz-1" });
    const b = makeOrdersScopeKey(["store-1", "store-2"], { businessId: "biz-1" });

    expect(a).toBe(b);
    expect(a).toContain("stores=store-1,store-2");
  });

  it("renders empty scopes as a stable placeholder", () => {
    const key = makeOrdersScopeKey([]);
    expect(key).toContain("stores=-");
    expect(key).toContain("sources=-");
    expect(makeOrdersScopeKey(null)).toBe(makeOrdersScopeKey([]));
    expect(makeOrdersScopeKey([null, undefined])).toBe(makeOrdersScopeKey([]));
  });

  it("separates businesses", () => {
    const one = makeOrdersScopeKey(["s1"], { businessId: "biz-1" });
    const two = makeOrdersScopeKey(["s1"], { businessId: "biz-2" });
    expect(one).not.toBe(two);
  });

  it("separates order-source scopes", () => {
    const a = makeOrdersScopeKey(["s1"], { orderSourceIds: ["src-1"] });
    const b = makeOrdersScopeKey(["s1"], { orderSourceIds: ["src-2"] });
    const c = makeOrdersScopeKey(["s1"], { orderSourceIds: ["src-2", "src-1"] });

    expect(a).not.toBe(b);
    expect(c).toContain("sources=src-1,src-2");
  });

  it("separates context sessions even for the same business", () => {
    const a = makeOrdersScopeKey(["s1"], { businessId: "biz-1", sessionScope: "ctx-1" });
    const b = makeOrdersScopeKey(["s1"], { businessId: "biz-1", sessionScope: "ctx-2" });
    expect(a).not.toBe(b);
  });
});

describe("ordersContextSessionToken", () => {
  it("is stable for one context object", () => {
    const context = { id: "biz-1" };
    const first = ordersContextSessionToken(context);
    expect(ordersContextSessionToken(context)).toBe(first);
    expect(first).toMatch(/^ctx-\d+$/);
  });

  it("mints a distinct token per context object", () => {
    expect(ordersContextSessionToken({ id: "biz-1" })).not.toBe(
      ordersContextSessionToken({ id: "biz-1" }),
    );
  });

  it("falls back to a stable token when no context exists", () => {
    expect(ordersContextSessionToken(null)).toBe("none");
    expect(ordersContextSessionToken(undefined)).toBe("none");
  });
});