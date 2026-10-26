import { vi, type Mock } from "vitest";

/**
 * A tiny predicate-aware stand-in for the Supabase client used by the
 * hybrid-tenancy (issue #16) tests.
 *
 * Unlike the record-only builders in the older tests, this fake RESOLVES rows
 * through the predicates the caller applied, so a scoped read is proved to have
 * an effect and not merely to exist: a query carrying
 * `.in("store_id", ["s1"])` returns only store `s1` rows, and an unscoped query
 * returns every row in the fixture (the leak the tests are written against).
 *
 * It records every call, so assertions can also be taken on the exact predicates
 * put on the wire.
 */

export type Row = Record<string, unknown>;
export type QueryCall = { method: string; args: unknown[] };
export type Query = { table: string; calls: QueryCall[]; payload?: unknown };

export interface SupabaseMockShape {
  from: Mock;
  functions: { invoke: Mock };
  auth?: { getUser: Mock };
}

const PREDICATE_METHODS = new Set([
  "eq",
  "neq",
  "in",
  "is",
  "not",
  "gt",
  "gte",
  "lt",
  "lte",
]);

/** Evaluates the row predicates recorded on a query (select/order are ignored). */
const matchesPredicates = (row: Row, query: Query): boolean => {
  for (const call of query.calls) {
    if (!PREDICATE_METHODS.has(call.method)) continue;
    const [column, ...rest] = call.args as [string, ...unknown[]];
    const value = row[column];
    switch (call.method) {
      case "eq":
        if (value !== rest[0]) return false;
        break;
      case "neq":
        if (value === rest[0]) return false;
        break;
      case "in":
        if (!((rest[0] as unknown[]) ?? []).includes(value)) return false;
        break;
      case "is":
        if (rest[0] === null ? value != null : value !== rest[0]) return false;
        break;
      case "not":
        // Only `not(col, "is", null)` is exercised by these reads.
        if (rest[0] === "is" && rest[1] === null && value == null) return false;
        break;
      case "gt":
        if (!(Number(value) > Number(rest[0]))) return false;
        break;
      case "gte":
        if (!(Number(value) >= Number(rest[0]))) return false;
        break;
      case "lt":
        if (!(Number(value) < Number(rest[0]))) return false;
        break;
      case "lte":
        if (!(Number(value) <= Number(rest[0]))) return false;
        break;
      default:
        break;
    }
  }
  return true;
};

const CHAIN_METHODS = [
  "select",
  "order",
  "eq",
  "neq",
  "in",
  "is",
  "or",
  "not",
  "gt",
  "gte",
  "lt",
  "lte",
  "limit",
  "range",
  "filter",
  "match",
];

export const installFakeTenantClient = (supabase: SupabaseMockShape) => {
  let rows: Record<string, Row[]> = {};
  const state = { queries: [] as Query[] };
  let markedAt = 0;

  const makeBuilder = (query: Query) => {
    const builder: Record<string, unknown> = {};
    const record =
      (method: string) =>
      (...args: unknown[]) => {
        query.calls.push({ method, args });
        return builder;
      };
    for (const method of CHAIN_METHODS) builder[method] = vi.fn(record(method));
    builder.update = vi.fn((payload: unknown) => {
      query.calls.push({ method: "update", args: [payload] });
      query.payload = payload;
      return builder;
    });
    builder.insert = vi.fn((payload: unknown) => {
      query.calls.push({ method: "insert", args: [payload] });
      query.payload = payload;
      return builder;
    });
    builder.delete = vi.fn(() => {
      query.calls.push({ method: "delete", args: [] });
      return builder;
    });

    const result = (): { data: unknown; error: null } => {
      const calls = query.calls;
      if (calls.some((call) => call.method === "insert")) {
        const payload = query.payload;
        const list = Array.isArray(payload) ? payload : [payload];
        return {
          data: list.map((row, index) => ({ id: `new-${index + 1}`, ...(row as Row) })),
          error: null,
        };
      }
      if (calls.some((call) => call.method === "update" || call.method === "delete")) {
        return { data: null, error: null };
      }
      return {
        data: (rows[query.table] ?? []).filter((row) => matchesPredicates(row, query)),
        error: null,
      };
    };
    const settleSingle = () => {
      const value = result().data;
      const first = Array.isArray(value) ? value[0] ?? null : value ?? null;
      return Promise.resolve({ data: first, error: null });
    };

    builder.single = vi.fn(settleSingle);
    builder.maybeSingle = vi.fn(settleSingle);
    builder.then = (onFulfilled: (value: unknown) => unknown) =>
      Promise.resolve(result()).then(onFulfilled);
    return builder;
  };

  supabase.from.mockImplementation((table: string) => {
    const query: Query = { table, calls: [] };
    state.queries.push(query);
    return makeBuilder(query);
  });
  supabase.functions.invoke.mockImplementation(() => Promise.resolve({ data: null, error: null }));

  return {
    invoke: supabase.functions.invoke,
    setRows(next: Record<string, Row[]>) {
      rows = next;
    },
    /** Forget every recorded query: assertions then cover only what follows. */
    mark() {
      markedAt = state.queries.length;
      supabase.functions.invoke.mockClear();
    },
    reset(next: Record<string, Row[]> = {}) {
      rows = next;
      state.queries.length = 0;
      markedAt = 0;
      supabase.from.mockClear();
      supabase.functions.invoke.mockClear();
    },
    all() {
      return state.queries;
    },
    sinceMark() {
      return state.queries.slice(markedAt);
    },
    queriesFor(table: string) {
      return state.queries.filter((query) => query.table === table);
    },
    firstQuery(table: string, method: string) {
      return state.queries.find(
        (query) => query.table === table && query.calls.some((call) => call.method === method),
      );
    },
    argsFor(table: string, method: string) {
      return state.queries
        .filter((query) => query.table === table)
        .flatMap((query) =>
          query.calls.filter((call) => call.method === method).map((call) => call.args),
        );
    },
    /** Every scaffold-only JSdom gap the Radix primitives touch. */
    installUiShims() {
      const globals = globalThis as unknown as Record<string, unknown>;
      if (!globals.ResizeObserver) {
        globals.ResizeObserver = class {
          observe() {}
          unobserve() {}
          disconnect() {}
        };
      }
      const proto = Element.prototype as unknown as Record<string, unknown>;
      if (!proto.hasPointerCapture) proto.hasPointerCapture = () => false;
      if (!proto.setPointerCapture) proto.setPointerCapture = () => {};
      if (!proto.releasePointerCapture) proto.releasePointerCapture = () => {};
      if (!proto.scrollIntoView) proto.scrollIntoView = () => {};
    },
  };
};
