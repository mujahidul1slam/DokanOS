import { beforeEach, describe, expect, it, vi } from "vitest";

// Option B (2026-11-01 user decision): operational-store provisioning.
// Pinned contract:
//   • a `local://` store space is never syncable (isSyncableStoreUrl mirror in
//     supabase/functions/_shared/store-url-guard.ts is the edge-side guard);
//   • provisionOperationalStore links the brand only while it is free
//     (brands.woo_store_id IS NULL) — the brand link is load-bearing for RLS
//     (user_can_access_store gates on it, 20261026120000:43-61);
//   • an occupied brand keeps its link: the new row is only the source's sync
//     record and must never be linked away from the catalog store;
//   • bridgeWooSourceToStore stamps order_sources.legacy_woo_store_id and sets
//     stores.status='connected' only for a full http(s) connection;
//   • the stores insert is a BARE insert with a client-assigned uuid — never
//     `.select()`/`.single()` (= INSERT … RETURNING, which the SELECT policy
//     rejects for newborn unlinked store rows: the RLS landmine pinned by
//     supabase/tests/rls/operational_store_provisioning_test.sql).

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));

import { supabase } from "@/integrations/supabase/client";
import {
  isLocalStoreUrl,
  isSyncableStoreUrl,
  localStoreUrl,
  provisionOperationalStore,
} from "@/lib/operationalStores";

type Result = { data?: unknown; error?: unknown };

const queues: Record<string, Result[]> = {};
const insertPayloads: Record<string, unknown[]> = {};
const updatePayloads: Record<string, unknown[]> = {};
let trace: Array<{ table: string; method: string; args: unknown[] }> = [];
/** Deterministic stand-in for crypto.randomUUID (the store row id). */
let nextUuid = "store-1";

function push(table: string, ...results: Result[]) {
  (queues[table] ??= []).push(...results);
}

beforeEach(() => {
  for (const key of Object.keys(queues)) delete queues[key];
  for (const key of Object.keys(insertPayloads)) delete insertPayloads[key];
  for (const key of Object.keys(updatePayloads)) delete updatePayloads[key];
  trace = [];
  nextUuid = "store-1";
  vi.stubGlobal("crypto", { randomUUID: () => nextUuid });
  vi.clearAllMocks();
  (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    const queue = queues[table] ?? [];
    const record = (method: string, args: unknown[]) => {
      trace.push({ table, method, args });
    };
    const builder: Record<string, (...args: unknown[]) => unknown> & {
      then: (resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) => Promise<unknown>;
    } = {
      select: (...args: unknown[]) => {
        record("select", args);
        return builder;
      },
      insert: (...args: unknown[]) => {
        record("insert", args);
        (insertPayloads[table] ??= []).push(args[0]);
        return builder;
      },
      update: (...args: unknown[]) => {
        record("update", args);
        (updatePayloads[table] ??= []).push(args[0]);
        return builder;
      },
      eq: (...args: unknown[]) => {
        record("eq", args);
        return builder;
      },
      is: (...args: unknown[]) => {
        record("is", args);
        return builder;
      },
      single: () => {
        record("single", []);
        return builder;
      },
      maybeSingle: () => {
        record("maybeSingle", []);
        return builder;
      },
      then: (resolve, reject) =>
        Promise.resolve(queue.shift() ?? { data: null, error: null }).then(resolve, reject),
    };
    return builder;
  });
});

const methodsOf = (table: string, method: string) =>
  trace.filter((t) => t.table === table && t.method === method);

describe("store URL classification", () => {
  it("marks local:// spaces as local and never syncable", () => {
    expect(isLocalStoreUrl("local://acme")).toBe(true);
    expect(isLocalStoreUrl(" LOCAL://Acme ")).toBe(true);
    expect(isLocalStoreUrl("https://acme.test")).toBe(false);
    expect(isLocalStoreUrl(null)).toBe(false);
  });

  it("only treats http(s) URLs as syncable", () => {
    expect(isSyncableStoreUrl("https://acme.test")).toBe(true);
    expect(isSyncableStoreUrl("http://acme.test/")).toBe(true);
    expect(isSyncableStoreUrl("local://acme")).toBe(false);
    expect(isSyncableStoreUrl("ftp://acme.test")).toBe(false);
    expect(isSyncableStoreUrl(undefined)).toBe(false);
  });

  it("builds a slug URL for local stores", () => {
    expect(localStoreUrl("Acme Brand")).toBe("local://acme-brand");
    expect(localStoreUrl("  ")).toBe("local://store");
  });
});

describe("provisionOperationalStore", () => {
  it("creates the store row and links a free brand (guarded link-when-free)", async () => {
    push("brands", { data: { id: "brand-1", woo_store_id: null }, error: null });
    push("stores", { data: null, error: null }); // bare insert — no RETURNING
    push("brands", { data: [{ id: "brand-1" }], error: null });

    const result = await provisionOperationalStore({
      brandId: "brand-1",
      name: "Acme Store",
      url: "https://acme.test",
      status: "connected",
      consumerKey: "ck",
      consumerSecret: "cs",
    });

    expect(result).toEqual({ storeId: "store-1", linked: true });
    expect(insertPayloads.stores[0]).toEqual({
      id: "store-1",
      name: "Acme Store",
      url: "https://acme.test",
      status: "connected",
      consumer_key: "ck",
      consumer_secret: "cs",
    });
    // LANDMINE PIN: the stores insert must never be read back through
    // `.select()`/`.single()` — INSERT … RETURNING fails the SELECT policy for
    // newborn unlinked store rows ("new row violates row-level security policy").
    expect(methodsOf("stores", "select")).toHaveLength(0);
    expect(methodsOf("stores", "single")).toHaveLength(0);
    expect(methodsOf("stores", "maybeSingle")).toHaveLength(0);
    // The link update must be guarded (.is("woo_store_id", null)).
    const updates = methodsOf("brands", "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].args[0]).toEqual({ woo_store_id: "store-1" });
    const guards = methodsOf("brands", "is");
    expect(guards).toHaveLength(1);
    expect(guards[0].args).toEqual(["woo_store_id", null]);
  });

  it("keeps an occupied brand link and reports linked=false (no dead second link)", async () => {
    nextUuid = "store-2";
    push("brands", { data: { id: "brand-1", woo_store_id: "store-existing" }, error: null });
    push("stores", { data: null, error: null });

    const result = await provisionOperationalStore({
      brandId: "brand-1",
      name: "Second Source",
      url: "https://other.test",
      status: "disconnected",
    });

    expect(result).toEqual({ storeId: "store-2", linked: false });
    expect(methodsOf("brands", "update")).toHaveLength(0);
  });

  it("validates required fields before any write", async () => {
    await expect(
      provisionOperationalStore({ brandId: "b", name: " ", url: "x", status: "disconnected" }),
    ).rejects.toThrow("Store name is required.");
    await expect(
      provisionOperationalStore({ brandId: "b", name: "x", url: "", status: "disconnected" }),
    ).rejects.toThrow("Store URL is required.");
    await expect(
      provisionOperationalStore({ brandId: "", name: "x", url: "y", status: "disconnected" }),
    ).rejects.toThrow("no brand to attach it to");
    expect(methodsOf("stores", "insert")).toHaveLength(0);
  });

  it("fails before writing when the brand is not readable", async () => {
    push("brands", { data: null, error: null }); // maybeSingle → no row
    await expect(
      provisionOperationalStore({ brandId: "ghost", name: "x", url: "y", status: "disconnected" }),
    ).rejects.toThrow("Brand not found or not accessible.");
    expect(methodsOf("stores", "insert")).toHaveLength(0);
  });
});
