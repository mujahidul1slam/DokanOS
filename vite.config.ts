import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  build: {
    target: "es2020",
    minify: "esbuild",
    cssCodeSplit: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
    // Note: do NOT split React/Recharts/Radix into separate vendor chunks here.
    // Recharts (and Radix) read `React.forwardRef` at module-eval time, so if the
    // chart chunk ever evaluates before the React chunk finishes loading you get
    // "Cannot read properties of undefined (reading 'forwardRef')" and a blank
    // screen on production hosts (e.g. Vercel). Letting Rollup decide chunking
    // keeps React inlined with its consumers and avoids that race.
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
}));
