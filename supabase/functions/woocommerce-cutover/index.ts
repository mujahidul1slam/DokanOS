import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import {
  describeWooExternalOrderId,
  isValidWooExternalOrderId,
  matchWooOrder,
  planCutoverEnqueue,
  type CutoverIdentity,
  type CutoverOrder,
} from "../../../src/lib/woocommerceCutover.ts";
import { nextWooPageUrl } from "../../../src/lib/woocommerceReconciliation.ts";

const MAX_PAGES = 100;
const corsHeaders = {
  "content-type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Raw WooCommerce v3 order fields consumed by the cutover scanner. Only these
// external facts are trusted; payload tenant identifiers are never read.
type WooOrder = {
  id?: unknown;
  status?: string;
  date_modified_gmt?: string;
  date_created_gmt?: string;
  total?: string;
  billing?: { email?: string; first_name?: string; last_name?: string; address_1?: string; address_2?: string; city?: string };
  line_items?: { sku?: string }[];
};

// Legacy local Orders that predate provable connector identity. Scoped to the
// connector's Business so fuzzy matching can never cross tenant boundaries.
type LegacyOrderRow = {
  id: string;
  customer_email: string | null;
  customer_name: string | null;
  customer_address: string | null;
  customer_city: string | null;
  total: number | string | null;
  created_at: string | null;
  updated_at: string | null;
};

function client() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
}
function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
function credentials(ref: string): { consumer_key: string; consumer_secret: string } {
  const raw = Deno.env.get(ref);
  if (!raw) throw new Error("woocommerce_credentials_unavailable");
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") throw new Error("woocommerce_credentials_invalid");
  return parsed as { consumer_key: string; consumer_secret: string };
}
function asNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
// Normalize to a canonical ISO instant, dropping unparseable timestamps. A
// malformed Woo timestamp must never abort the whole cutover run.
function isoOrUndefined(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function toCutoverOrder(value: unknown): CutoverOrder | null {
  if (!value || typeof value !== "object") return null;
  const order = value as WooOrder;
  if (!isValidWooExternalOrderId(order.id)) return null;
  const externalId = order.id;
  const billing = order.billing ?? {};
  const sku = (order.line_items ?? []).map((item) => item.sku).find((item) => typeof item === "string" && item.trim());
  return {
    id: externalId,
    status: order.status ?? "",
    dateModified: isoOrUndefined(order.date_modified_gmt),
    dateCreated: isoOrUndefined(order.date_created_gmt),
    total: asNumber(order.total) ?? undefined,
    email: billing.email,
    name: [billing.first_name, billing.last_name].filter(Boolean).join(" ") || undefined,
    sku: sku || undefined,
    address: [billing.address_1, billing.address_2, billing.city].filter(Boolean).join(", ") || undefined,
  };
}

// `id` is the index into legacyUuids so matchWooOrder() returns index-string
// candidates that can be mapped back to real local Order UUIDs for the DB.
function toLegacyCutover(row: LegacyOrderRow, index: number): CutoverOrder {
  return {
    id: index,
    status: "",
    dateModified: isoOrUndefined(row.updated_at ?? row.created_at),
    total: asNumber(row.total) ?? undefined,
    email: row.customer_email ?? undefined,
    name: row.customer_name ?? undefined,
    address: [row.customer_address, row.customer_city].filter(Boolean).join(", ") || undefined,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "method_not_allowed" }, 405);
  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return response({ error: "auth_required" }, 401);
  const sb = client();
  const user = await sb.auth.getUser(authorization.slice("Bearer ".length));
  if (user.error || !user.data.user) return response({ error: "auth_required" }, 401);
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return response({ error: "invalid_request" }, 400);
  const input = body as Record<string, unknown>;
  const connectorId = typeof input.connector_id === "string" ? input.connector_id : "";
  const dryRun = input.dry_run !== false;
  const requestedWatermark = typeof input.watermark === "string" ? new Date(input.watermark) : new Date();
  if (!connectorId || Number.isNaN(requestedWatermark.getTime())) return response({ error: "invalid_cutover_request" }, 400);

  const connector = await sb.from("woocommerce_connectors")
    .select("id,business_id,external_store_url,credentials_ref,expected_webhook_id,webhook_status,intake_enabled,status")
    .eq("id", connectorId).maybeSingle();
  if (connector.error || !connector.data) return response({ error: "connector_not_found" }, 404);
  const membership = await sb.from("user_business_access").select("role")
    .eq("business_id", connector.data.business_id).eq("user_id", user.data.user.id).maybeSingle();
  if (membership.error || !membership.data || !["owner", "admin"].includes(membership.data.role)) return response({ error: "admin_required" }, 403);
  if (connector.data.webhook_status !== "active" || !connector.data.expected_webhook_id || !connector.data.intake_enabled) return response({ error: "active_verified_webhook_required" }, 409);

  const run = await sb.rpc("create_woocommerce_cutover_run", { p_connector_id: connectorId, p_mode: dryRun ? "dry_run" : "backfill", p_watermark: requestedWatermark.toISOString() });
  if (run.error || !run.data) return response({ error: run.error?.message ?? "cutover_run_failed" }, 409);
  const runRow = Array.isArray(run.data) ? run.data[0] : run.data;
  const start = new Date(runRow.window_start);
  const end = new Date(runRow.window_end);
  const auth = credentials(connector.data.credentials_ref);
  const token = btoa(`${auth.consumer_key}:${auth.consumer_secret}`);
  let url: string | null = `${connector.data.external_store_url.replace(/\/$/, "")}/wp-json/wc/v3/orders?modified_after=${encodeURIComponent(start.toISOString())}&modified_before=${encodeURIComponent(end.toISOString())}&orderby=modified&order=asc&per_page=100&page=1`;
  let pages = 0; let requests = 0; let discovered = 0; let enqueued = 0; let exact = 0; let review = 0; let unmapped = 0; let failures = 0; const conflicts = 0;
  const pageMetadata: unknown[] = [];
  const failureDetails: string[] = [];
  try {
    // Exact identity is connector + Woo Order ID only. Every other similarity
    // signal produces an operator-review candidate that is NEVER auto-merged.
    const identitiesResult = await sb.from("woocommerce_order_identities")
      .select("external_order_id,order_id").eq("connector_id", connectorId);
    if (identitiesResult.error) throw new Error(`woocommerce_identity_lookup_failed: ${identitiesResult.error.message}`);
    const identityRows = identitiesResult.data ?? [];
    const identities: CutoverIdentity[] = identityRows.flatMap((row) => {
      const externalOrderId = typeof row.external_order_id === "number"
        ? row.external_order_id
        : typeof row.external_order_id === "string" && /^[1-9]\d*$/.test(row.external_order_id)
          ? Number(row.external_order_id)
          : null;
      return externalOrderId !== null && isValidWooExternalOrderId(externalOrderId)
        ? [{ connectorId, externalOrderId, localOrderId: row.order_id }]
        : [];
    });
    const knownLocalIds = new Set(identityRows.map((row) => row.order_id));
    // Only legacy `woocommerce` Orders inside this connector's Business without
    // a provable external identity are fuzzy-review candidates. Rows with an
    // unknown business_id are excluded (fail closed on tenancy).
    const legacyResult = await sb.from("orders")
      .select("id,customer_email,customer_name,customer_address,customer_city,total,created_at,updated_at")
      .eq("source", "woocommerce")
      .eq("business_id", connector.data.business_id)
      .is("deleted_at", null);
    if (legacyResult.error) throw new Error(`woocommerce_legacy_lookup_failed: ${legacyResult.error.message}`);
    const legacyRows = ((legacyResult.data ?? []) as LegacyOrderRow[])
      .filter((row) => !knownLocalIds.has(row.id));
    const legacyUuids = legacyRows.map((row) => row.id);
    const legacyOrders = legacyRows.map((row, index) => toLegacyCutover(row, index));

    while (url && pages < MAX_PAGES) {
      requests += 1;
      const requestUrl = url;
      const result = await fetch(requestUrl, { redirect: "manual", headers: { Authorization: `Basic ${token}`, Accept: "application/json" } });
      if (result.status >= 300 && result.status < 400) {
        const location = result.headers.get("location");
        if (!location) throw new Error("woocommerce_redirect_location_missing");
        nextWooPageUrl(requestUrl, `<${location}>; rel="next"`, connector.data.external_store_url);
        throw new Error("woocommerce_redirect_requires_manual_follow");
      }
      if (!result.ok) throw new Error(`woocommerce_http_${result.status}`);
      const payload: unknown = await result.json();
      if (!Array.isArray(payload)) throw new Error("woocommerce_invalid_collection");
      pages += 1; discovered += payload.length;
      for (const value of payload) {
        const order = value as WooOrder;
        const cutoverOrder = toCutoverOrder(value);
        if (!cutoverOrder) {
          const malformedId = value && typeof value === "object" ? (value as WooOrder).id : undefined;
          failures += 1;
          const malformedDetail = `Malformed WooCommerce order payload: external ID is ${describeWooExternalOrderId(malformedId)}`;
          failureDetails.push(malformedDetail);
          const item = await sb.from("woocommerce_cutover_report_items").insert({
            run_id: runRow.id, connector_id: connectorId, external_order_id: null,
            external_status: typeof (value as WooOrder)?.status === "string" ? (value as WooOrder).status : null,
            match_kind: "unmapped", local_order_id: null, fuzzy_candidate_ids: [], fuzzy_signals: [],
            outcome: "failed", work_id: null, failure_class: "incomplete", failure_detail: malformedDetail,
            external_snapshot: value,
          });
          if (item.error) failureDetails.push(item.error.message.slice(0, 500));
          continue;
        }
        const externalId = cutoverOrder.id!;
        const status = cutoverOrder.status;
        const match = matchWooOrder(cutoverOrder, connectorId, identities, legacyOrders);
        const matchKind = match.kind;
        let fuzzyCandidateIds: string[] = [];
        let fuzzySignals: string[] = [];
        if (match.kind === "exact") exact += 1;
        else if (match.kind === "review") {
          review += 1;
          fuzzySignals = match.signals;
          fuzzyCandidateIds = match.candidates
            .map((candidate) => legacyUuids[Number(candidate)])
            .filter((id): id is string => typeof id === "string");
        } else unmapped += 1;
        let outcome: string = match.kind === "exact" ? "already_known" : match.kind === "review" ? "review" : "unmapped";
        let workId: string | null = null;
        const enqueue = planCutoverEnqueue({ dryRun, matchKind: match.kind, status });
        if (enqueue.failureClass === "unsupported_status") { outcome = "unsupported"; failures += 1; }
        else if (enqueue.work) {
          // supabase-js's `onConflict` option only accepts a column list; it cannot
          // express the partial-index predicate `WHERE state IN (...)`. The old
          // `onConflict: "connector_id,identity_key,state"` no longer resolves because
          // 20261113130000 replaced that constraint with the partial unique index
          // woocommerce_sync_work_live_identity_key. So: plain insert, and a live
          // sibling is detected from the 23505 error instead.
          const cutoverIdentityKey = `cutover:${runRow.id}:${externalId}`;
          const inserted = await sb.from("woocommerce_sync_work").insert({ connector_id: connectorId, direction: "reconciliation", kind: "order_refresh", external_order_id: externalId, identity_key: cutoverIdentityKey, payload: { source: "cutover", cutover_run_id: runRow.id, external_order_id: externalId, match_kind: matchKind } }).select("id").maybeSingle();
          if (!inserted.error) {
            enqueued += 1; outcome = "queued"; workId = inserted.data?.id ?? null;
          } else if (inserted.error.code === "23505") {
            // A live row already owns this identity; reuse it. The partial index only
            // constrains live states, so this lookup cannot pick up terminal history.
            const existing = await sb.from("woocommerce_sync_work").select("id").eq("connector_id", connectorId).eq("identity_key", cutoverIdentityKey).in("state", ["pending", "leased", "retrying"]).maybeSingle();
            if (existing.error) { failures += 1; outcome = "failed"; }
            else { enqueued += 1; outcome = "queued"; workId = existing.data?.id ?? null; }
          } else { failures += 1; outcome = "failed"; }
        }
        const item = await sb.from("woocommerce_cutover_report_items").insert({
          run_id: runRow.id, connector_id: connectorId, external_order_id: externalId,
          external_status: status, match_kind: matchKind,
          local_order_id: match.kind === "exact" ? match.localOrderId : null,
          fuzzy_candidate_ids: fuzzyCandidateIds, fuzzy_signals: fuzzySignals,
          outcome, work_id: workId,
          failure_class: enqueue.failureClass,
          failure_detail: outcome === "unsupported" ? `Unsupported status: ${status}` : null,
          external_snapshot: { id: externalId, status, date_modified_gmt: order.date_modified_gmt, total: order.total },
        });
        if (item.error) {
          failures += 1;
          failureDetails.push(item.error.message.slice(0, 500));
        }
      }
      pageMetadata.push({ url: requestUrl, status: result.status, count: payload.length, next: result.headers.get("link") });
      url = nextWooPageUrl(requestUrl, result.headers.get("link"), connector.data.external_store_url);
    }
    if (url) failures += 1;
    const finalState = failures > 0 ? "partial" : dryRun ? "dry_run_complete" : "backfill_complete";
    const finished = await sb.rpc("finish_woocommerce_cutover_run", { p_run_id: runRow.id, p_state: finalState, p_pages: pages, p_requests: requests, p_discovered: discovered, p_enqueued: enqueued, p_exact_matches: exact, p_review_candidates: review, p_unmapped: unmapped, p_failure_count: failures, p_conflict_count: conflicts, p_page_metadata: pageMetadata, p_report_metadata: { dry_run: dryRun, failure_details: failureDetails.slice(0, 10) } });
    if (finished.error || finished.data !== true) throw new Error(finished.error?.message ?? "cutover_run_finish_failed");
    return response({ run_id: runRow.id, state: finalState, dry_run: dryRun, window: { start: start.toISOString(), end: end.toISOString() }, pages, requests, discovered, enqueued, exact_matches: exact, review_candidates: review, unmapped, failures, failure_details: failureDetails.slice(0, 10) });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const failed = await sb.rpc("finish_woocommerce_cutover_run", { p_run_id: runRow.id, p_state: "failed", p_pages: pages, p_requests: requests, p_discovered: discovered, p_enqueued: enqueued, p_exact_matches: exact, p_review_candidates: review, p_unmapped: unmapped, p_failure_count: failures + 1, p_conflict_count: conflicts, p_page_metadata: pageMetadata, p_last_error: message.slice(0, 1000), p_error_class: "transport" });
    if (failed.error || failed.data !== true) {
      const finishMessage = failed.error?.message ?? "cutover_run_finish_failed";
      return response({ error: "cutover_failed", run_id: runRow.id, detail: `${message}; finish_failed: ${finishMessage}` }, 502);
    }
    return response({ error: "cutover_failed", run_id: runRow.id, detail: message }, 502);
  }
});
