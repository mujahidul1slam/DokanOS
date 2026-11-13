import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, db } = vi.hoisted(() => {
  const state = {
    connectors: [] as Record<string, unknown>[],
    rejections: [] as Record<string, unknown>[],
    rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
    rpcResults: [] as Array<{ data: unknown; error: { code?: string; message: string } | null }>,
    connectorUpdateErrors: [] as Array<{ code: string; message: string }>,
    nextId: 1,
  };
  // The subset of the PostgREST query builder the webhook handler actually
  // chains. Typed instead of `any` so the mock cannot silently drift from the
  // calls the handler makes.
  type QueryRow = Record<string, unknown>;
  type UpdateResult = { data: null; error: { code: string; message: string } | null };
  interface QueryBuilder {
    select(): QueryBuilder;
    eq(column: string, value: unknown): QueryBuilder;
    in(column: string, values: unknown[]): QueryBuilder;
    limit(count: number): Promise<{ data: QueryRow[]; error: null }>;
    insert(row: QueryRow): Promise<{ data: null; error: null }>;
    update(values: QueryRow): { eq(column: string, value: unknown): Promise<UpdateResult> };
  }
  const createClient = vi.fn(() => ({
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const query: QueryBuilder = {
        select() { return query; },
        eq(column: string, value: unknown) { filters.push([column, value]); return query; },
        in(column: string, values: unknown[]) { filters.push([column, values]); return query; },
        limit(count: number) { return Promise.resolve({ data: state.connectors.filter((row) => filters.every(([k, v]) => Array.isArray(v) ? v.includes(row[k]) : row[k] === v)).slice(0, count), error: null }); },
        insert(row: Record<string, unknown>) {
          if (table === "woocommerce_webhook_rejections") state.rejections.push({ ...row, id: `rejection-${state.nextId++}` });
          return Promise.resolve({ data: null, error: null });
        },
        update(values: Record<string, unknown>) {
          return { eq(column: string, value: unknown) { const error = state.connectorUpdateErrors.shift() ?? null; if (!error) { const row = state.connectors.find((candidate) => candidate[column] === value); if (row) Object.assign(row, values); } return Promise.resolve({ data: null, error }); } };
        },
      };
      return query;
    },
    rpc(name: string, args: Record<string, unknown>) {
      state.rpcCalls.push({ name, args });
      return Promise.resolve(state.rpcResults.shift() ?? { data: { status: "accepted", delivery_id: `delivery-${state.nextId++}`, work_id: `work-${state.nextId++}` }, error: null });
    },
  }));
  return { createClient, db: state };
});
vi.mock("npm:@supabase/supabase-js@2.49.4", () => ({ createClient }));

const secret = "test-only-woo-webhook-secret";
const connector = { id: "connector-test", business_id: "business-test", brand_id: "brand-test", store_id: "store-test", order_source_id: "source-test", external_store_url: "https://shop.example", expected_webhook_id: 42, webhook_secret_fingerprint: null, webhook_secret_ref: "WOO_TEST_WEBHOOK_SECRET", previous_webhook_secret_ref: null, previous_secret_expires_at: null, intake_enabled: true, status: "healthy" };
type EdgeRuntime = { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Response | Promise<Response>): void };
const edgeRuntime = globalThis as typeof globalThis & { Deno?: EdgeRuntime };
let handler: ((request: Request) => Promise<Response>) | undefined;
async function signature(body: string) { const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))))); }
async function requestFor(input: { body?: string; deliveryId?: string | null; validSignature?: boolean; topic?: string; resource?: string } = {}) { const body = input.body ?? JSON.stringify({ id: 731, status: "processing" }); const signed = await signature(body); return new Request("https://edge.test/woocommerce-webhook", { method: "POST", headers: { "x-wc-webhook-source": "https://shop.example/", "x-wc-webhook-id": "42", "x-wc-webhook-topic": input.topic ?? "order.updated", "x-wc-webhook-resource": input.resource ?? "order", ...(input.deliveryId === null ? {} : { "x-wc-webhook-delivery-id": input.deliveryId ?? "delivery-test" }), "x-wc-webhook-signature": input.validSignature === false ? "invalid-signature" : signed }, body }); }
async function send(input?: Parameters<typeof requestFor>[0]) { if (!handler) throw new Error("Deno.serve handler not registered"); return handler(await requestFor(input)); }
beforeEach(async () => { db.connectors = [{ ...connector }]; db.rejections = []; db.rpcCalls = []; db.rpcResults = []; db.connectorUpdateErrors = []; db.nextId = 1; edgeRuntime.Deno = { env: { get: (name) => name === "SUPABASE_URL" ? "https://supabase.test" : name === "SUPABASE_SERVICE_ROLE_KEY" ? "test-service-key" : name === "WOO_TEST_WEBHOOK_SECRET" ? secret : undefined }, serve: (registered) => { handler = registered as (request: Request) => Promise<Response>; } }; vi.resetModules(); const handlerModule = "../../supabase/functions/woocommerce-webhook/index.ts"; await import(handlerModule); });
afterEach(() => { edgeRuntime.Deno = undefined; handler = undefined; });

describe("WooCommerce webhook HTTP intake", () => {
  it("calls the exact durable RPC contract", async () => { const response = await send({ deliveryId: "delivery-accepted" }); expect(response.status).toBe(200); expect(db.rpcCalls).toHaveLength(1); expect(db.rpcCalls[0]).toMatchObject({ name: "accept_woocommerce_webhook_delivery", args: { p_connector_id: "connector-test", p_webhook_id: 42, p_delivery_id: "delivery-accepted", p_topic: "order.updated", p_resource: "order", p_source_url: "https://shop.example/", p_payload_version: null, p_external_order_id: 731 } }); expect(typeof db.rpcCalls[0].args.p_delivery_fingerprint).toBe("string"); expect(db.rpcCalls[0].args.p_raw_body).toBe("\\x7b226964223a3733312c22737461747573223a2270726f63657373696e67227d"); });
  it("preserves arbitrary UTF-8 bytes in the bytea wire representation", async () => {
    const body = `{"id":731,"note":"café  😀"}`.replace("\u0000", "\\u0000");
    const response = await send({ body, deliveryId: "delivery-bytes" });
    expect(response.status).toBe(200);
    const rawBody = db.rpcCalls[0].args.p_raw_body;
    expect(rawBody).toBe(`\\x${Array.from(new TextEncoder().encode(body), (byte) => byte.toString(16).padStart(2, "0")).join("")}`);

    expect(rawBody).toContain("c3a9");
    expect(rawBody).toContain("f09f9880");
  });
  it("returns duplicate and repaired statuses", async () => { db.rpcResults.push({ data: { status: "duplicate", delivery_id: "d", work_id: "w" }, error: null }, { data: { status: "repaired", delivery_id: "d", work_id: "w" }, error: null }); const duplicate = await send(); const repaired = await send(); expect(await duplicate.json()).toMatchObject({ accepted: true, duplicate: true, durable: true }); expect(await repaired.json()).toMatchObject({ accepted: true, duplicate: true, durable: true }); });
  it("maps conflict and RPC failures without promotion", async () => { db.rpcResults.push({ data: { status: "conflict" }, error: null }, { data: null, error: { message: "temporary" } }, { data: null, error: null }); expect((await send()).status).toBe(409); expect((await send()).status).toBe(503); expect((await send()).status).toBe(503); expect(db.connectors[0].webhook_status).toBeUndefined(); });
  it("rejects invalid signature without RPC", async () => { const response = await send({ validSignature: false }); expect(response.status).toBe(401); expect(db.rpcCalls).toHaveLength(0); expect(db.rejections).toHaveLength(1); });
  it("recovers from invalid to valid and sends absent ID as null", async () => { expect((await send({ validSignature: false, deliveryId: null })).status).toBe(401); expect((await send({ deliveryId: null })).status).toBe(200); expect(db.rpcCalls).toHaveLength(1); expect(db.rpcCalls[0].args.p_delivery_id).toBeNull(); });
  it.each([["unsupported", { topic: "product.updated" }], ["malformed", { body: "{" }], ["missing ID", { body: JSON.stringify({ status: "processing" }) }]] as const)("rejects %s without RPC", async (_name, input) => { expect((await send(input)).status).toBe(400); expect(db.rpcCalls).toHaveLength(0); });
});

export {};
