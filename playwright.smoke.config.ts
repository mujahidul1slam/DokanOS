import { defineConfig } from "@playwright/test";

/**
 * Real-stack smoke configuration.
 *
 * Unlike playwright.accounts.config.ts (which mocks the Supabase API), this
 * config runs against the REAL local stack: real Auth, real PostgREST, real
 * edge functions, real Mailpit for confirmation links.
 *
 * Prerequisites:
 *   - Vite dev server running on VERIFY_APP_URL (default :5173)
 *   - `supabase start` + `supabase db reset` applied
 *   - Mailpit reachable at :54324
 *   - PLAYWRIGHT_CHANNEL=chrome on hosts where bundled Chromium is incomplete
 */
export default defineConfig({
  testDir: "./tests/smoke",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: process.env.VERIFY_APP_URL || "http://127.0.0.1:5173",
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL,
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5173 --strictPort",
    url: process.env.VERIFY_APP_URL || "http://127.0.0.1:5173",
    reuseExistingServer: true,
    env: {
      VITE_SUPABASE_URL: process.env.SMOKE_SUPABASE_URL || "http://127.0.0.1:54321",
      VITE_SUPABASE_PUBLISHABLE_KEY: process.env.SMOKE_SUPABASE_ANON_KEY || "local-smoke-test-key",
    },
  },
});
