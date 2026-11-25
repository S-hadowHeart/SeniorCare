import { defineConfig } from "vitest/config";

/**
 * Server test configuration.
 *
 * The integration suites talk to a real PostgreSQL database through Prisma, so
 * test files run sequentially (`fileParallelism: false`) — every suite starts
 * from a truncated schema and parallel writers would race on each other.
 *
 * `tests/setup.ts` must run before any module imports `src/config/env.ts`: it
 * points the process at the isolated test database and fills in the secrets
 * that the configuration schema requires.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov", "html"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      // Generated Prisma client, the process bootstrap and ambient types are
      // not application logic; counting them would only drown the signal.
      exclude: ["src/generated/**", "src/index.ts", "src/**/*.d.ts"],
      // Floors sit just below the current totals. They are a ratchet: adding
      // untested code fails the build until it is covered.
      thresholds: {
        statements: 64,
        branches: 55,
        functions: 54,
        lines: 65,
      },
    },
  },
});
