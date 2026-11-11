import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "npm:@supabase/supabase-js@2.49.4": path.resolve(__dirname, "./src/test/fixtures/denoSupabaseClient.ts"),
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
