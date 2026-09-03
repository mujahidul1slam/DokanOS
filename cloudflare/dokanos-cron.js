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
//        */5 * * * *
//      and a second one:
//        */15 * * * *
//   5. Optional: watch logs via the worker's "Live logs" tail.
//
// WHAT IT DOES
//   - every 5 min  : drain the sync_queue (sync-worker full-drain)
//   - every 15 min: import Woo changes (woo-sync-all) + refresh Pathao
//                   tracking (track_all)
//
// AFTERCARE (when this becomes the primary scheduler)
//   - Demote the three GitHub workflows (.github/workflows/*.yml) to once-a-day
//     dead-man's-switch runs: each alerts if the queue's newest updated_at is
//     stale — headers documenting the switch are already in those files.
//   - The demoted workflows can keep using the same SYNC_WORKER_CRON_TOKEN.
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

    // Every 5 minutes (and also on the */15 tick — harmless duplicate: the
    // claim RPC's SKIP LOCKED makes concurrent drains safe).
    await run("sync-worker", () =>
      fetch(`${SB}/functions/v1/sync-worker`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ANON_KEY}`,
          "x-cron-secret": env.SYNC_WORKER_CRON_TOKEN,
        },
        body: "{}",
      })
    );

    // Every 15 minutes only.
    if (event.cron === "*/15 * * * *") {
      await run("woo-sync-all", () =>
        fetch(`${SB}/functions/v1/woo-sync-all`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${ANON_KEY}`,
            // woo-sync-all checks the woo_sync_cron_token vault secret — same
            // GitHub secret WOO_SYNC_CRON_TOKEN. Reuse it here; if you'd
            // rather keep distinct tokens, set env.WOO_SYNC_CRON_TOKEN too.
            "x-cron-secret": env.WOO_SYNC_CRON_TOKEN || env.SYNC_WORKER_CRON_TOKEN,
          },
          body: "{}",
        })
      );

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
