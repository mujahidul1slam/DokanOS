# SIGNUP OPERATIONS, RUNBOOK & MONITORING
**Task 4.1 Deliverable — DokanOS Self-Serve Launch Operations**

---

## 1. Funnel Analytics Queries

To monitor signup conversion across all stages, run the following query against the database or dashboard SQL editor:

```sql
-- 24-Hour Signup Funnel Conversion Summary
WITH funnel_counts AS (
  SELECT
    count(*) FILTER (WHERE event = 'signup_started') AS started,
    count(*) FILTER (WHERE event = 'email_confirmed') AS confirmed,
    count(*) FILTER (WHERE event = 'provisioned') AS provisioned,
    count(*) FILTER (WHERE event = 'site_opened') AS storefront_published,
    count(*) FILTER (WHERE event = 'provision_failed') AS provision_failed,
    count(*) FILTER (WHERE event = 'self_deleted_unprovisioned') AS self_cancelled
  FROM public.signup_events
  WHERE created_at >= now() - interval '24 hours'
)
SELECT
  started,
  confirmed,
  round((confirmed::numeric / nullif(started, 0)) * 100, 1) AS confirm_pct,
  provisioned,
  round((provisioned::numeric / nullif(confirmed, 0)) * 100, 1) AS provision_pct,
  storefront_published,
  round((storefront_published::numeric / nullif(provisioned, 0)) * 100, 1) AS publish_pct,
  provision_failed,
  self_cancelled
FROM funnel_counts;
```

---

## 2. Real-Time Alert Queries

### A. High Provisioning Failure Rate Alert (> 5% in past hour)
```sql
SELECT
  count(*) FILTER (WHERE event = 'provision_failed') AS failed,
  count(*) FILTER (WHERE event IN ('provisioned', 'provision_failed')) AS total_attempts,
  round(
    count(*) FILTER (WHERE event = 'provision_failed')::numeric /
    nullif(count(*) FILTER (WHERE event IN ('provisioned', 'provision_failed')), 0) * 100, 1
  ) AS failure_pct
FROM public.signup_events
WHERE created_at >= now() - interval '1 hour'
HAVING count(*) FILTER (WHERE event = 'provision_failed')::numeric /
       nullif(count(*) FILTER (WHERE event IN ('provisioned', 'provision_failed')), 0) > 0.05;
```

### B. High Rate-Limiting or Abuse Alert
```sql
SELECT
  split_part(key, ':', 1) AS limit_type,
  sum(count) AS total_hits,
  count(DISTINCT key) AS impacted_actors
FROM public.rate_limit_hits
WHERE bucket >= now() - interval '24 hours'
GROUP BY 1
ORDER BY total_hits DESC;
```

---

## 3. Data Retention Verification

The data retention job runs automatically via the `purge-unconfirmed` edge function and `public.run_data_retention_cleanup()`.

To verify manual retention execution:
```sql
SELECT public.run_data_retention_cleanup();
```
Expected output:
```json
{
  "status": "ok",
  "anonymized_ips": 0,
  "purged_old_events": 0,
  "purged_rate_hits": 0
}
```

---

## 4. Launch & Go-Live Runbook

Follow these sequential steps in the **Supabase Dashboard**:

1. **Authentication Redirect URLs**:
   Under **Authentication > URL Configuration > Redirect URLs**, ensure the following paths are whitelisted:
   - `https://your-domain.com/auth/confirm`
   - `https://your-domain.com/welcome`
   - `https://your-domain.com/check-email`
   - `https://your-domain.com/reset-password`
   - `https://your-domain.com/welcome/setup-failed`

2. **Custom SMTP Provider**:
   Under **Authentication > SMTP Settings**:
   - Enable Custom SMTP (SendGrid, Resend, or AWS SES).
   - Test email deliverability to ensure emails arrive in under 5 seconds.

3. **Cloudflare Turnstile Setup**:
   Under **Authentication > Bot Protection**:
   - Provider: **Cloudflare Turnstile**
   - Enter your Cloudflare Site Key and Secret Key.

4. **Minimum Password Length**:
   Under **Authentication > Password Security**:
   - Set Minimum Password Length to `10`.

5. **Runtime Enablement**:
   The runtime toggle is already active in `app_config`:
   ```sql
   SELECT key, value FROM public.app_config WHERE key = 'signup_open';
   ```
   To pause signups instantly at any time:
   ```sql
   UPDATE public.app_config SET value = 'false'::jsonb WHERE key = 'signup_open';
   ```
