// DokanOS scheduler — Cloudflare Worker with Cron Triggers (revamp Phase 1.1)
//
// DEPLOY (dashboard flow, ~5 minutes — no wrangler/npm needed):
//   1. dash.cloudflare.com -> Workers & Pages -> Create Worker -> name it
//      `dokanos-cron` -> deploy the default (hello-world) code.
//   2. Edit code: paste this entire file, Deploy.
//   3. Settings -> Variables & Secrets -> Add variable:
//        - SYNC_WORKER_CRON_TOKEN = z4i13r8XGeY2ASnPhyabNQ20IviKCGoA
//      (same value as the Supabase vault secret `sync_worker_cron_token` and
//      the GitHub repo secret SYNC_WORKER_CRON_TOKEN)
//   4. Settings -> Trigger Events -> Cron Triggers -> Add:
//        */15 * * * *
//      (the old */5 drain trigger is obsolete — nothing runs on it now)
//   5. Optional: watch logs via the worker's "Live logs" tail.
//
// WHAT IT DOES
//   - every 15 min: refresh Pathao tracking (pathao-courier track_all)
//
// HISTORY
//   This worker used to also drain the sync_queue (sync-worker, every 5 min)
//   and import Woo changes (woo-sync-all, every 15 min). Both were retired with
//   the WooCommerce integration: the sync_queue table, its RPCs and the two
//   functions are gone, so calling them now 404s. Only the Pathao poll remains,
//   and it is the sole reason this worker still exists.
//
// AFTERCARE (when this becomes the primary scheduler)
//   - The GitHub workflow .github/workflows/pathao-tracking.yml runs the same
//     poll every 15 min. Once this worker is confirmed live, demote that
//     workflow to a once-a-day dead-man's-switch (its header describes the
//     switch). It can keep using the same SYNC_WORKER_CRON_TOKEN.
//
// NOTES
//   - Supabase edge functions need ~30s per drain batch sometimes; CF cron
//     handlers have no strict per-request timeout worry here (CPU ~30s limit,
//     but these are all network waits, which don't count as CPU time).
//   - CF free plan allows cron triggers down to 1-minute granularity.

const SB = "https://jiwndicvfkiltgageqwv.supabase.co";

// Anon key: public/publishable project JWT (same one in the frontend bundle
// and the GitHub workflows) — only needed to pass the API gateway; the real
// auth is the x-cron-secret vault token checked inside each function.
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imppd25kaWN2ZmtpbHRnYWdlcXd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzMjg5OTcsImV4cCI6MjEwMDkwNDk5N30.zWbTtxLYD1hw-vQ7qZdxm1NgUSWYHsS-0wWXg89_7MY";

export default {
  async scheduled(event, env, ctx) {
    const run = async (label, fn) => {
      try {
        const res = await fn();
        const body = await res.text();
        console.log(`[${label}] HTTP ${res.status} ${body.slice(0, 300)}`);
      } catch (e) {
        console.error(`[${label}] FAILED: ${e?.message || e}`);
      }
    };

    // Every 15 minutes only.
    if (event.cron === "*/15 * * * *") {
      await run("pathao-track", () =>
        fetch(`${SB}/functions/v1/pathao-courier`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${ANON_KEY}`,
            "x-cron-secret": env.SYNC_WORKER_CRON_TOKEN,
          },
          body: JSON.stringify({ action: "track_all" }),
        })
      );
    }
  },
};
