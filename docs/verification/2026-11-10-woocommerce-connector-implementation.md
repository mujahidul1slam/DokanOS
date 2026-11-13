# Issue 47 WooCommerce connector implementation

## Scope delivered

This slice implements the durable connector boundary and the order-only processing path described by issue 47:

- Connector-scoped, server-resolved Store/Brand/Business/Order source binding.
- Secret references and fingerprints only; credentials and webhook secrets remain deployment-managed.
- Connector health, pause, rollback, cutover/reconciliation watermarks, and webhook metadata.
- Connector-scoped WooCommerce Order identity mapping.
- Immutable raw webhook delivery evidence with delivery-id/fingerprint deduplication.
- Durable inbound, reconciliation, and outbound work with leases, expiry, heartbeat, retries, dead-letter, quarantine, and replay functions.
- Reconciliation run metadata and pagination/watermark preservation.
- External WooCommerce status facts stored separately from local Order/Fulfillment state.
- Conservative inbound status mapping and conservative outbound `processing`, `completed`, and pre-dispatch `cancelled` writes.
- HMAC-SHA256 verification over the exact raw body with constant-time byte comparison.
- Edge Functions for signed intake, worker processing, reconciliation, and owner/admin health/pause/rollback/replay controls.
- Pure contract tests for status mapping, outbound safety, HMAC verification, retry classification/backoff, Link pagination, and idempotency.

## Evidence

- `vitest/mocked`: `npm test -- --run src/test/woocommerceConnector.test.ts` — 15 passed.
- `vitest/mocked`: `npm test` — 940 passed, 3 skipped.
- `tsc`: `npm run typecheck` — passed.
- `vite`: `npm run build` — passed.
- `git diff --check` — no whitespace errors in the connector changes.

## Not claimed by this artifact

A local Supabase migration rehearsal and real WooCommerce/local-stack canary were not run in this environment: the Supabase CLI is unavailable. Production deployment, webhook registration, secret provisioning/rotation, scheduler setup, and cloud verification remain release-gated actions and were not performed.

The owner/admin UI surface is represented by the protected `woocommerce-admin` Edge Function in this slice; a browser UI and full real-stack/RLS battery should be added before enabling a production connector.
