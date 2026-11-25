/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Vite configuration.
 *
 * * `@tailwindcss/vite` — Tailwind CSS v4 is compiled through the Vite
 *   plugin, which is dramatically faster than the standalone PostCSS
 *   pipeline and needs no `tailwind.config.js` (the theme lives in CSS).
 * * `resolve.tsconfigPaths` — native support for the `@/` alias declared in
 *   tsconfig (no extra plugin needed on Vite 8).
 * * The dev server proxies `/api` to the Express API so that the browser
 *   only ever talks to a single origin — no CORS in development and the
 *   same topology as production (nginx → API).
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    // Component tests run in a real DOM implementation, through the same
    // React components the browser loads.
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    clearMocks: true,
    restoreMocks: true,
    css: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov", "html"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/main.tsx", "src/test/**", "src/**/*.d.ts"],
      // The component suite currently exercises auth, forms and the SOS flow;
      // these floors prevent those gains from being diluted by new untested
      // code while the remaining pages gain coverage.
      thresholds: {
        statements: 21.6,
        branches: 13.7,
        functions: 17.9,
        lines: 22.5,
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY ?? "http://127.0.0.1:4000",
        changeOrigin: true,
        // Server-Sent Events must not be buffered by the proxy.
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            if (proxyRes.headers["content-type"]?.includes("text/event-stream")) {
              proxyRes.headers["cache-control"] = "no-cache, no-transform";
            }
          });
        },
      },
    },
  },
  preview: {
    port: 4173,
    strictPort: true,
    // The preview server mirrors the production topology (nginx serves the
    // SPA and proxies /api to Express) so that the built bundle can be
    // exercised end to end.
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY ?? "http://127.0.0.1:4000",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
    cssCodeSplit: true,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        /**
         * Split the heavy, rarely-changing dependencies into their own
         * chunks so that a code change in the application code does not
         * invalidate them in the browser cache.
         */
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](recharts|d3-|victory-|internmap|delaunator|robust-predicates)/.test(id)) {
            return "charts";
          }
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|scheduler|react-router-dom)[\\/]/.test(id)) {
            return "react";
          }
          if (/[\\/]node_modules[\\/](react-hook-form|@hookform|zod)[\\/]/.test(id)) {
            return "forms";
          }
          return undefined;
        },
      },
    },
  },
});
