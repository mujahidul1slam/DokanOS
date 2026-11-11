/**
 * Vertical WooCommerce sync test: cutover -> queued work -> worker -> persisted
 * local Order, all against the real local stack.
 *
 * Why this exists: every other WooCommerce test proves one layer in isolation.
 * `src/test/woocommerceCutover.test.ts` proves the pure planner, the SQL tests
 * prove single RPCs, and the handler tests prove one Edge Function with a mocked
 * Supabase client. Nothing proved that the three layers agree with each other:
 * that a cutover scan enqueues work the worker can actually claim, and that the
 * worker's import path writes a local Order with the shape the SQL contract
 * promises. This file closes that gap (handoff defect 8).
 *
 * The stack under test is deliberately real:
 *   - real Edge Function source (`supabase/functions/woocommerce-cutover` and
 *     `supabase/functions/woocommerce-worker`), imported unmodified;
 *   - the real `@supabase/supabase-js` client talking to the local PostgREST,
 *     so every query string and RPC argument is exercised as written;
 *   - the real local PostgreSQL schema and RPC bodies;
 *   - a real HTTP server standing in for WooCommerce, reachable at
 *     `http://127.0.0.1:<port>` — an address the connector URL trigger allows
 *     on purpose for development.
 *
 * It is opt-in in the sense that it needs the local Supabase stack: it runs when
 * the stack answers, and skips otherwise (so CI, where no stack exists, stays
 * green). To force it on or off regardless of detection:
 *
 *   npx supabase start
 *   npx vitest run src/test/woocommerceVerticalSync.test.ts
 *   LOCAL_WOOCOMMERCE_VERTICAL=0 npx vitest run src/test/woocommerceVerticalSync.test.ts
 *
 * Nothing here may ever point at a hosted project: `assertLocal()` refuses any
 * Supabase URL whose host is not loopback, and the WooCommerce stand-in only
 * ever listens on 127.0.0.1.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import pg from "pg";

// The vitest config aliases the literal specifier `npm:@supabase/supabase-js@2.49.4`
// to a stub that throws on use. The Edge Functions import exactly that specifier,
// so the stub is replaced here with the real client: the point of this test is the
// real PostgREST round-trip. `@supabase/supabase-js` (bare specifier) is not
// aliased, so it resolves to the installed package.
vi.mock("npm:@supabase/supabase-js@2.49.4", async () => {
  const actual = await import("@supabase/supabase-js");
  return { createClient: actual.createClient };
});

const { Client } = pg;

type LocalConfig = {
  apiUrl: string;
  dbUrl: string;
  anonKey: string;
  serviceRoleKey: string;
};

function assertLocal(label: string, value: string): void {
  const host = new URL(value).hostname;
  if (!new Set(["127.0.0.1", "localhost", "[::1]"]).has(host)) {
    throw new Error(`refusing non-local ${label}: ${host}`);
  }
}

/**
 * Reads the local stack credentials from the CLI, then refuses anything that is
 * not loopback. `supabase status` reports the linked project ref too; it is
 * ignored on purpose — only the URLs are trusted, and only after assertLocal().
 */
function localConfig(): LocalConfig {
  const raw = execSync("npx supabase status -o json", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const pick = (key: string): string => {
    const value = parsed[key];
    if (typeof value !== "string" || value.length === 0) throw new Error(`supabase status has no ${key}`);
    return value;
  };
  const apiUrl = pick("API_URL");
  const dbUrl = pick("DB_URL");
  assertLocal("API_URL", apiUrl);
  assertLocal("DB_URL", dbUrl);
  return { apiUrl, dbUrl, anonKey: pick("ANON_KEY"), serviceRoleKey: pick("SERVICE_ROLE_KEY") };
}

type Fixture = {
  businessId: string;
  storeId: string;
  brandId: string;
  orderSourceId: string;
  connectorId: string;
  userId: string;
  userEmail: string;
  userPassword: string;
};

type WooOrder = Record<string, unknown>;

const CREDENTIALS_REF = "WOO_VERTICAL_CREDENTIALS";
const WEBHOOK_SECRET_REF = "WOO_VERTICAL_WEBHOOK_SECRET";
const CONSUMER_KEY = "ck_vertical_local";
const CONSUMER_SECRET = "cs_vertical_local";

function wooOrder(externalId: number, overrides: Partial<WooOrder> = {}): WooOrder {
  return {
    id: externalId,
    number: `WC-${externalId}`,
    status: "processing",
    currency: "USD",
    total: "1500.00",
    shipping_total: "100.00",
    discount_total: "50.00",
    payment_method: "cod",
    customer_note: "Leave at the side gate",
    date_created_gmt: "2026-02-01T09:00:00",
    date_modified_gmt: "2026-02-02T10:30:00",
    billing: {
      first_name: "Nadia",
      last_name: "Rahman",
      email: "nadia.vertical@example.test",
      phone: "+8801700000000",
      address_1: "12 Test Lane",
      address_2: "Apt 4B",
      city: "Dhaka",
      state: "Dhaka",
      postcode: "1207",
    },
    line_items: [
      { name: "Vertical Widget", quantity: 2, price: "600.00", total: "1200.00", sku: "VW-1" },
      { name: "Vertical Gadget", quantity: 1, price: "300.00", total: "300.00", sku: "VG-1" },
    ],
    ...overrides,
  };
}

/**
 * Minimal WooCommerce v3 stand-in. It answers exactly the two endpoints the
 * functions call and rejects anything else, so a request the test did not expect
 * fails loudly instead of silently succeeding.
 */
function startWooStore(orders: Map<number, WooOrder>, expectedBasic: string) {
  const requests: Array<{ method: string; path: string; authorized: boolean; body?: unknown }> = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const authorized = req.headers.authorization === `Basic ${expectedBasic}`;
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const single = url.pathname.match(/^\/wp-json\/wc\/v3\/orders\/(\d+)$/);

    // The outbound path: the worker PUTs `{status}` and trusts the echoed
    // status as confirmation. The stand-in applies the change to its own copy,
    // exactly as WooCommerce would, so a second read sees the new status.
    if (single && req.method === "PUT") {
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => {
        let parsed: unknown = null;
        try { parsed = JSON.parse(raw); } catch { /* recorded as null below */ }
        requests.push({ method: "PUT", path: url.pathname, authorized, body: parsed });
        if (!authorized) return send(401, { code: "woocommerce_rest_cannot_edit", message: "Unauthorized" });
        const order = orders.get(Number(single[1]));
        if (!order) return send(404, { code: "woocommerce_rest_shop_order_invalid_id", message: "Invalid ID" });
        const requested = (parsed as { status?: unknown } | null)?.status;
        if (typeof requested !== "string") return send(400, { code: "rest_invalid_param", message: "status required" });
        const updated = { ...order, status: requested, date_modified_gmt: "2026-02-03T08:00:00" };
        orders.set(Number(single[1]), updated);
        return send(200, updated);
      });
      return undefined;
    }

    requests.push({ method: req.method ?? "", path: url.pathname, authorized });
    if (!authorized) return send(401, { code: "woocommerce_rest_cannot_view", message: "Unauthorized" });
    if (url.pathname === "/wp-json/wc/v3/orders" && req.method === "GET") {
      // No Link header: one page, so the pagination path stays out of scope here.
      return send(200, [...orders.values()]);
    }
    if (single && req.method === "GET") {
      const order = orders.get(Number(single[1]));
      if (!order) return send(404, { code: "woocommerce_rest_shop_order_invalid_id", message: "Invalid ID" });
      return send(200, order);
    }
    return send(404, { code: "rest_no_route", message: "No route" });
  });
  return new Promise<{ server: Server; port: number; requests: typeof requests }>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "string" || address === null) return reject(new Error("no ephemeral port"));
      resolve({ server, port: address.port, requests });
    });
  });
}

/**
 * Decides whether the local stack is reachable. Detection is deliberately cheap
 * and read-only: `supabase status -o json` either reports a loopback API URL or
 * it fails. `LOCAL_WOOCOMMERCE_VERTICAL` overrides both directions, so a machine
 * with a stack can still opt out and a stack-less machine can opt in to see the
 * failure rather than a silent skip.
 */
function localStackAvailable(): boolean {
  const override = process.env.LOCAL_WOOCOMMERCE_VERTICAL;
  if (override === "0") return false;
  if (override === "1") return true;
  try {
    const raw = execSync("npx supabase status -o json", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const apiUrl = (JSON.parse(raw) as Record<string, unknown>).API_URL;
    if (typeof apiUrl !== "string") return false;
    return new Set(["127.0.0.1", "localhost", "[::1]"]).has(new URL(apiUrl).hostname);
  } catch {
    return false;
  }
}

const enabled = localStackAvailable();

describe.skipIf(!enabled)("WooCommerce vertical sync (cutover -> worker -> persisted order)", () => {
  let config: LocalConfig;
  let db: pg.Client;
  let fixture: Fixture;
  let woo: Awaited<ReturnType<typeof startWooStore>>;
  let cutoverHandler: (request: Request) => Promise<Response>;
  let workerHandler: (request: Request) => Promise<Response>;
  let cronToken: string;
  let accessToken: string;
  let admin: import("@supabase/supabase-js").SupabaseClient;

  const externalOrderId = 5001;

  beforeAll(async () => {
    config = localConfig();
    db = new Client({ connectionString: config.dbUrl });
    await db.connect();

    const orders = new Map<number, WooOrder>([[externalOrderId, wooOrder(externalOrderId)]]);
    woo = await startWooStore(orders, Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString("base64"));
    // `localhost` rather than `127.0.0.1`: the connector scope trigger
    // (`public.validate_woocommerce_connector_scope`) accepts only HTTPS or the
    // literal `http://localhost…` development form, even though the sibling
    // normalize trigger also allows `127.0.0.1`. The stand-in listens on
    // 127.0.0.1, which `localhost` resolves to.
    const storeUrl = `http://localhost:${woo.port}`;

    // Real Auth user so the cutover function's `auth.getUser()` and membership
    // check run exactly as they do in production.
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(config.apiUrl, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const suffix = randomUUID().slice(0, 8);
    const email = `woo-vertical-${suffix}@example.test`;
    const password = `Vertical-${suffix}-Pass1`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`createUser failed: ${created.error?.message}`);
    const userClient = createClient(config.apiUrl, config.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signedIn = await userClient.auth.signInWithPassword({ email, password });
    if (signedIn.error || !signedIn.data.session) throw new Error(`signIn failed: ${signedIn.error?.message}`);
    accessToken = signedIn.data.session.access_token;

    fixture = {
      businessId: randomUUID(),
      storeId: randomUUID(),
      brandId: randomUUID(),
      orderSourceId: randomUUID(),
      connectorId: randomUUID(),
      userId: created.data.user.id,
      userEmail: email,
      userPassword: password,
    };

    // Fixture rows are written as the database superuser so the connector
    // triggers run (they validate scope, URL and secret-reference shape) without
    // needing a second tenant-context dance.
    await db.query(
      `INSERT INTO public.businesses (id, name, slug, currency, timezone)
       VALUES ($1, 'Vertical Sync Business', $2, 'USD', 'Asia/Dhaka')`,
      [fixture.businessId, `vertical-${suffix}`],
    );
    await db.query(
      `INSERT INTO public.stores (id, name, url, status)
       VALUES ($1, 'Vertical Sync Store', $2, 'connected')`,
      [fixture.storeId, storeUrl],
    );
    await db.query(
      `INSERT INTO public.brands (id, business_id, name, slug, woo_store_id, is_active)
       VALUES ($1, $2, 'Vertical Sync Brand', $3, $4, true)`,
      [fixture.brandId, fixture.businessId, `vertical-brand-${suffix}`, fixture.storeId],
    );
    await db.query(
      `INSERT INTO public.order_sources (id, brand_id, name, type)
       VALUES ($1, $2, 'Vertical Woo Source', 'woocommerce')`,
      [fixture.orderSourceId, fixture.brandId],
    );
    await db.query(
      `INSERT INTO public.woocommerce_connectors
         (id, business_id, brand_id, store_id, order_source_id, external_store_url,
          status, intake_enabled, outbound_enabled, credentials_ref, webhook_secret_ref,
          webhook_secret_fingerprint, expected_webhook_id, expected_webhook_topic, webhook_status)
       VALUES ($1, $2, $3, $4, $5, $6, 'healthy', true, false, $7, $8, $9, 9001, 'order.updated', 'active')`,
      [
        fixture.connectorId,
        fixture.businessId,
        fixture.brandId,
        fixture.storeId,
        fixture.orderSourceId,
        storeUrl,
        CREDENTIALS_REF,
        WEBHOOK_SECRET_REF,
        "a".repeat(64),
      ],
    );
    await db.query(
      `INSERT INTO public.user_business_access (user_id, business_id, role, joined_via)
       VALUES ($1, $2, 'owner', 'created')`,
      [fixture.userId, fixture.businessId],
    );

    const tokenRow = await db.query<{ token: string }>(
      "SELECT public.get_sync_worker_cron_token() AS token",
    );
    cronToken = tokenRow.rows[0].token;

    // The Edge Functions read their configuration through `Deno.env.get` and
    // register a handler through `Deno.serve`. Installing that shim is the whole
    // trick that lets unmodified function source run inside vitest.
    const env: Record<string, string> = {
      SUPABASE_URL: config.apiUrl,
      SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey,
      [CREDENTIALS_REF]: JSON.stringify({ consumer_key: CONSUMER_KEY, consumer_secret: CONSUMER_SECRET }),
      [WEBHOOK_SECRET_REF]: "vertical-webhook-secret",
    };
    const deno = {
      env: { get: (name: string) => env[name] },
      serve: (handler: (request: Request) => Promise<Response>) => {
        // Each module registers exactly one handler; the caller decides which.
        registered.push(handler);
      },
    };
    (globalThis as typeof globalThis & { Deno?: unknown }).Deno = deno;

    vi.resetModules();
    registered.length = 0;
    // The specifiers are held in variables on purpose: `tsconfig.app.json`
    // includes only `src`, so a literal specifier into `supabase/functions`
    // would pull Deno-typed Edge source into the app typecheck and fail on the
    // `npm:` import scheme and the missing `Deno` global. Vite resolves the
    // variable at runtime exactly the same way.
    const cutoverModule = "../../supabase/functions/woocommerce-cutover/index.ts";
    const workerModule = "../../supabase/functions/woocommerce-worker/index.ts";
    await import(/* @vite-ignore */ cutoverModule);
    cutoverHandler = registered[0];
    registered.length = 0;
    await import(/* @vite-ignore */ workerModule);
    workerHandler = registered[0];
    if (!cutoverHandler || !workerHandler) throw new Error("an Edge Function did not register a handler");
  }, 120_000);

  const registered: Array<(request: Request) => Promise<Response>> = [];

  afterAll(async () => {
    if (woo?.server) await new Promise<void>((resolve) => woo.server.close(() => resolve()));
    if (db) {
      // Teardown mirrors the durable-intake race harness: evidence tables are
      // immutable by trigger, so cleanup runs with replication triggers disabled
      // in a single transaction and rolls back if anything refuses.
      try {
        await db.query("BEGIN");
        await db.query("SET LOCAL session_replication_role = replica");
        for (const [table, column] of [
          ["woocommerce_cutover_report_items", "connector_id"],
          ["woocommerce_cutover_runs", "connector_id"],
          ["woocommerce_outbound_writes", "connector_id"],
          ["woocommerce_sync_conflicts", "connector_id"],
          ["woocommerce_sync_work", "connector_id"],
          ["woocommerce_order_identities", "connector_id"],
          ["woocommerce_webhook_deliveries", "connector_id"],
        ] as const) {
          await db.query(`DELETE FROM public.${table} WHERE ${column} = $1`, [fixture.connectorId]);
        }
        await db.query("DELETE FROM public.order_items WHERE order_id IN (SELECT id FROM public.orders WHERE business_id = $1)", [fixture.businessId]);
        await db.query("DELETE FROM public.orders WHERE business_id = $1", [fixture.businessId]);
        await db.query("DELETE FROM public.customers WHERE business_id = $1", [fixture.businessId]);
        await db.query("DELETE FROM public.woocommerce_connectors WHERE id = $1", [fixture.connectorId]);
        await db.query("DELETE FROM public.order_sources WHERE id = $1", [fixture.orderSourceId]);
        await db.query("DELETE FROM public.user_business_access WHERE business_id = $1", [fixture.businessId]);
        await db.query("DELETE FROM public.brands WHERE id = $1", [fixture.brandId]);
        await db.query("DELETE FROM public.stores WHERE id = $1", [fixture.storeId]);
        await db.query("DELETE FROM public.businesses WHERE id = $1", [fixture.businessId]);
        await db.query("COMMIT");
      } catch (cause) {
        await db.query("ROLLBACK").catch(() => undefined);
        throw cause;
      } finally {
        if (fixture?.userId) await admin?.auth.admin.deleteUser(fixture.userId).catch(() => undefined);
        await db.end();
      }
    }
    (globalThis as typeof globalThis & { Deno?: unknown }).Deno = undefined;
  }, 60_000);

  it("scans a real backfill and enqueues claimable work", async () => {
    const response = await cutoverHandler(
      new Request(`${config.apiUrl}/functions/v1/woocommerce-cutover`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ connector_id: fixture.connectorId, dry_run: false }),
      }),
    );
    const body = await response.json() as Record<string, unknown>;
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({
      state: "backfill_complete",
      dry_run: false,
      pages: 1,
      discovered: 1,
      enqueued: 1,
      exact_matches: 0,
      review_candidates: 0,
      unmapped: 1,
      failures: 0,
    });

    // The WooCommerce stand-in must have been called once, authenticated.
    expect(woo.requests).toHaveLength(1);
    expect(woo.requests[0]).toMatchObject({ method: "GET", path: "/wp-json/wc/v3/orders", authorized: true });

    // The queued work is exactly what the worker's claim RPC looks for.
    const work = await db.query(
      `SELECT direction, kind, external_order_id, state, identity_key, payload
       FROM public.woocommerce_sync_work WHERE connector_id = $1`,
      [fixture.connectorId],
    );
    expect(work.rows).toHaveLength(1);
    expect(work.rows[0]).toMatchObject({
      direction: "reconciliation",
      kind: "order_refresh",
      external_order_id: String(externalOrderId),
      state: "pending",
    });
    expect(work.rows[0].identity_key).toBe(`cutover:${body.run_id}:${externalOrderId}`);
    expect(work.rows[0].payload).toMatchObject({ source: "cutover", match_kind: "unmapped" });

    // The cutover report records the decision the operator will read.
    const items = await db.query(
      `SELECT external_order_id, match_kind, outcome, local_order_id
       FROM public.woocommerce_cutover_report_items WHERE connector_id = $1`,
      [fixture.connectorId],
    );
    expect(items.rows).toHaveLength(1);
    expect(items.rows[0]).toMatchObject({
      external_order_id: String(externalOrderId),
      match_kind: "unmapped",
      outcome: "queued",
      local_order_id: null,
    });

    // Nothing was persisted yet: cutover only queues.
    const orders = await db.query("SELECT count(*)::int AS n FROM public.orders WHERE business_id = $1", [fixture.businessId]);
    expect(orders.rows[0].n).toBe(0);
  }, 60_000);

  it("runs the worker against the queued work and persists the local order", async () => {
    const response = await workerHandler(
      new Request(`${config.apiUrl}/functions/v1/woocommerce-worker`, {
        method: "POST",
        headers: { "x-woocommerce-scheduler-secret": cronToken },
      }),
    );
    const body = await response.json() as Record<string, unknown>;
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ claimed: 1 });
    expect((body.results as Array<{ state: string }>)[0]).toMatchObject({ state: "succeeded" });

    // The worker fetched the single order, authenticated.
    expect(woo.requests).toHaveLength(2);
    expect(woo.requests[1]).toMatchObject({
      method: "GET",
      path: `/wp-json/wc/v3/orders/${externalOrderId}`,
      authorized: true,
    });

    const order = await db.query(
      `SELECT id, order_number, source, status, payment_status, payment_method,
              subtotal, discount, shipping_cost, total, notes,
              customer_name, customer_email, customer_phone, customer_city,
              woocommerce_external_status, woocommerce_external_status_at,
              business_id, store_id, order_source_id
       FROM public.orders WHERE business_id = $1`,
      [fixture.businessId],
    );
    expect(order.rows).toHaveLength(1);
    const row = order.rows[0];

    // Money: total/shipping/discount come from Woo, subtotal is derived as
    // total - shipping - discount (1500 - 100 - 50 = 1350). That derivation is
    // deliberate in the worker and is pinned here so a change is visible.
    expect(Number(row.total)).toBe(1500);
    expect(Number(row.shipping_cost)).toBe(100);
    expect(Number(row.discount)).toBe(50);
    expect(Number(row.subtotal)).toBe(1350);

    // Identity and provenance.
    expect(row).toMatchObject({
      order_number: `WC-${externalOrderId}`,
      source: "woocommerce",
      payment_method: "cod",
      business_id: fixture.businessId,
      store_id: fixture.storeId,
      order_source_id: fixture.orderSourceId,
    });

    // Status mapping: Woo `processing` -> local `pending`, paid.
    expect(row.status).toBe("pending");
    expect(row.payment_status).toBe("paid");
    expect(row.woocommerce_external_status).toBe("processing");
    expect(row.woocommerce_external_status_at).not.toBeNull();
    // The customer note is the one customer-facing fact the import does copy.
    expect(row.notes).toBe("Leave at the side gate");

    // Customer facts land in `public.customers` (the RPC resolves-or-creates the
    // customer by email/phone), but the denormalized snapshot columns on
    // `public.orders` are left NULL. Asserting both halves pins the actual
    // behaviour and keeps the gap visible instead of silently assumed.
    const customer = await db.query(
      `SELECT id, name, email, phone, address, city, zone, area, source, origin_kind
       FROM public.customers WHERE business_id = $1`,
      [fixture.businessId],
    );
    expect(customer.rows).toHaveLength(1);
    expect(customer.rows[0]).toMatchObject({
      name: "Nadia Rahman",
      email: "nadia.vertical@example.test",
      phone: "+8801700000000",
      address: "12 Test Lane, Apt 4B",
      city: "Dhaka",
      zone: "Dhaka",
      area: "1207",
      source: "woocommerce",
      origin_kind: "woo_sync",
    });
    // The order is linked to that customer…
    const linked = await db.query("SELECT customer_id FROM public.orders WHERE id = $1", [row.id]);
    expect(linked.rows[0].customer_id).toBe(customer.rows[0].id);
    // …but the order's own customer snapshot is not populated by the import.
    // This is the documented fidelity gap (handoff defect 7), not an accident.
    expect(row.customer_name).toBeNull();
    expect(row.customer_email).toBeNull();
    expect(row.customer_phone).toBeNull();
    expect(row.customer_city).toBeNull();

    // Line items: the SQL contract imports name/quantity/price/total only. This
    // assertion documents the fidelity gap (no SKU, no product_id, no tax) so
    // that closing it is a deliberate, visible change.
    const items = await db.query(
      `SELECT product_name, quantity, unit_price, line_total, product_id, variation_id
       FROM public.order_items WHERE order_id = $1 ORDER BY product_name`,
      [row.id],
    );
    expect(items.rows).toHaveLength(2);
    expect(items.rows[0]).toMatchObject({ product_name: "Vertical Gadget", quantity: 1 });
    expect(Number(items.rows[0].unit_price)).toBe(300);
    expect(Number(items.rows[0].line_total)).toBe(300);
    expect(items.rows[1]).toMatchObject({ product_name: "Vertical Widget", quantity: 2 });
    expect(Number(items.rows[1].unit_price)).toBe(600);
    expect(Number(items.rows[1].line_total)).toBe(1200);
    // Fidelity gap, asserted rather than assumed: the import does not link
    // line items to catalogue products.
    expect(items.rows[0].product_id).toBeNull();
    expect(items.rows[0].variation_id).toBeNull();

    // The external identity row is what makes the next sync a refresh instead
    // of a second import.
    const identity = await db.query(
      `SELECT external_order_id, order_id, last_external_status, last_external_modified_at
       FROM public.woocommerce_order_identities WHERE connector_id = $1`,
      [fixture.connectorId],
    );
    expect(identity.rows).toHaveLength(1);
    expect(identity.rows[0]).toMatchObject({
      external_order_id: String(externalOrderId),
      order_id: row.id,
      last_external_status: "processing",
    });
    expect(new Date(identity.rows[0].last_external_modified_at).toISOString())
      .toBe(new Date("2026-02-02T10:30:00Z").toISOString());

    // The work row is terminal and leased by nobody.
    const work = await db.query(
      `SELECT state, lease_owner, lease_expires_at, attempt_count, last_error
       FROM public.woocommerce_sync_work WHERE connector_id = $1`,
      [fixture.connectorId],
    );
    expect(work.rows).toHaveLength(1);
    expect(work.rows[0]).toMatchObject({ state: "succeeded", lease_owner: null, attempt_count: 1, last_error: null });
  }, 60_000);

  it("is idempotent: a second cutover refreshes the same order instead of importing a copy", async () => {
    // The identity now exists, so the same scan must classify it as `exact`.
    const response = await cutoverHandler(
      new Request(`${config.apiUrl}/functions/v1/woocommerce-cutover`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ connector_id: fixture.connectorId, dry_run: false }),
      }),
    );
    const body = await response.json() as Record<string, unknown>;
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ state: "backfill_complete", exact_matches: 1, unmapped: 0, enqueued: 1 });

    const secondWork = await workerHandler(
      new Request(`${config.apiUrl}/functions/v1/woocommerce-worker`, {
        method: "POST",
        headers: { "x-woocommerce-scheduler-secret": cronToken },
      }),
    );
    const secondBody = await secondWork.json() as Record<string, unknown>;
    expect(secondWork.status, JSON.stringify(secondBody)).toBe(200);
    expect(secondBody).toMatchObject({ claimed: 1 });

    const orders = await db.query("SELECT count(*)::int AS n FROM public.orders WHERE business_id = $1", [fixture.businessId]);
    expect(orders.rows[0].n, "a refresh must not create a second local order").toBe(1);

    const identities = await db.query(
      "SELECT count(*)::int AS n FROM public.woocommerce_order_identities WHERE connector_id = $1",
      [fixture.connectorId],
    );
    expect(identities.rows[0].n).toBe(1);
  }, 60_000);

  it("writes a local status change back to WooCommerce through the outbound trigger", async () => {
    // Handoff defect 9: DokanOS -> WooCommerce had only a SQL trigger and fake
    // HTTP seams. This drives the whole chain for real: flip the local order to
    // `delivered`, let the AFTER UPDATE trigger enqueue the outbound write, then
    // run the worker so it PUTs the new status to the stand-in store.
    await db.query(
      "UPDATE public.woocommerce_connectors SET outbound_enabled = true WHERE id = $1",
      [fixture.connectorId],
    );
    const before = woo.requests.length;

    const updated = await db.query(
      "UPDATE public.orders SET status = 'delivered' WHERE business_id = $1 RETURNING id, status",
      [fixture.businessId],
    );
    expect(updated.rows).toHaveLength(1);
    expect(updated.rows[0].status).toBe("delivered");

    const write = await db.query(
      `SELECT id, target_status, origin, expected_external_status, state, idempotency_key
       FROM public.woocommerce_outbound_writes WHERE connector_id = $1`,
      [fixture.connectorId],
    );
    expect(write.rows).toHaveLength(1);
    expect(write.rows[0]).toMatchObject({
      target_status: "completed",
      origin: "delivered",
      expected_external_status: "processing",
      state: "pending",
    });

    const queued = await db.query(
      `SELECT direction, kind, state, payload FROM public.woocommerce_sync_work
       WHERE connector_id = $1 AND direction = 'outbound'`,
      [fixture.connectorId],
    );
    expect(queued.rows).toHaveLength(1);
    expect(queued.rows[0]).toMatchObject({ direction: "outbound", kind: "status_write", state: "pending" });
    expect(queued.rows[0].payload).toMatchObject({ target_status: "completed" });

    const response = await workerHandler(
      new Request(`${config.apiUrl}/functions/v1/woocommerce-worker`, {
        method: "POST",
        headers: { "x-woocommerce-scheduler-secret": cronToken },
      }),
    );
    const body = await response.json() as Record<string, unknown>;
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ claimed: 1 });
    expect((body.results as Array<{ state: string }>)[0]).toMatchObject({ state: "succeeded" });

    // Exactly one PUT, to the right order, carrying the mapped WooCommerce status.
    const outboundRequests = woo.requests.slice(before).filter((entry) => entry.method === "PUT");
    expect(outboundRequests).toHaveLength(1);
    expect(outboundRequests[0]).toMatchObject({
      path: `/wp-json/wc/v3/orders/${externalOrderId}`,
      authorized: true,
      body: { status: "completed" },
    });

    const settled = await db.query(
      "SELECT state, response_metadata FROM public.woocommerce_outbound_writes WHERE connector_id = $1",
      [fixture.connectorId],
    );
    expect(settled.rows[0]).toMatchObject({
      state: "succeeded",
      response_metadata: { confirmed_status: "completed" },
    });
    const outboundWork = await db.query(
      `SELECT state FROM public.woocommerce_sync_work
       WHERE connector_id = $1 AND direction = 'outbound'`,
      [fixture.connectorId],
    );
    expect(outboundWork.rows[0]).toMatchObject({ state: "succeeded" });
  }, 60_000);

  it("refuses a cutover for a connector without a verified webhook", async () => {
    await db.query(
      "UPDATE public.woocommerce_connectors SET webhook_status = 'paused' WHERE id = $1",
      [fixture.connectorId],
    );
    const response = await cutoverHandler(
      new Request(`${config.apiUrl}/functions/v1/woocommerce-cutover`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ connector_id: fixture.connectorId, dry_run: false }),
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "active_verified_webhook_required" });
    await db.query(
      "UPDATE public.woocommerce_connectors SET webhook_status = 'active' WHERE id = $1",
      [fixture.connectorId],
    );
  }, 30_000);

  it("rejects the worker without the scheduler secret", async () => {
    const response = await workerHandler(
      new Request(`${config.apiUrl}/functions/v1/woocommerce-worker`, { method: "POST" }),
    );
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("unauthorized");
  }, 30_000);
});

export {};
