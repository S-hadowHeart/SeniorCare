/**
 * Test bootstrap.
 *
 * Vitest loads this file before the test module graph, which is the only safe
 * point to rewrite the environment: `src/config/env.ts` validates and freezes
 * its configuration at import time.
 *
 * `TEST_DATABASE_URL` is mandatory and must point at a database (or schema)
 * that is safe to destroy — the suites truncate every table between tests.
 * There is deliberately no fallback to `DATABASE_URL`, so a misconfigured run
 * can never wipe development or production data.
 */
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error(
    [
      "TEST_DATABASE_URL is not set.",
      "",
      "Point it at an isolated PostgreSQL database or schema, for example:",
      "  postgresql://user:pass@host:5432/seniorcare_test?schema=seniorcare_test",
      "",
      "The test suites truncate every table, so never use the development database.",
    ].join("\n"),
  );
}

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = testDatabaseUrl;
process.env.DIRECT_DATABASE_URL = testDatabaseUrl;

// Deterministic secrets — valid for the configuration schema, used only here.
process.env.JWT_ACCESS_SECRET =
  "test-only-access-secret-0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

// Small, fast limit so that the lockout behaviour is exercised in a few attempts.
process.env.MAX_FAILED_LOGINS = "3";
process.env.LOCKOUT_MINUTES = "15";

process.env.MAIL_ENABLED = "false";
process.env.JOBS_ENABLED = "false";
process.env.CORS_ORIGINS = "http://localhost:5173";
process.env.LOG_LEVEL = "fatal";
process.env.LOG_PRETTY = "false";
