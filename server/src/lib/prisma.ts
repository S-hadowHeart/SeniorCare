import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { env } from "../config/env.js";
import { childLogger } from "./logger.js";

const log = childLogger("prisma");

/**
 * Prisma client singleton.
 *
 * Prisma 7 uses the TypeScript query compiler with a *driver adapter*
 * (`@prisma/adapter-pg`) instead of a Rust engine, which removes the native
 * binary from the deployment artefact and lets us control the connection
 * pool explicitly.
 *
 * The client is cached on `globalThis` in development so that hot-reloading
 * does not open a new pool on every file change (which would exhaust the
 * PostgreSQL `max_connections` limit).
 */
const SCHEMA_PATTERN = /^[a-z_][a-z0-9_]*$/i;

/**
 * PostgreSQL schema named by the `?schema=` query parameter.
 *
 * The Prisma CLI honours this parameter, but `pg` — and therefore the driver
 * adapter — does not: a client pointed at
 * `postgres://…/db?schema=seniorcare_test` still resolves unqualified names
 * against `public`. Tests rely on the schema to truncate only their own
 * tables, so the name must be applied to generated queries (the adapter
 * option) *and* to raw SQL (`search_path`).
 */
function schemaFromUrl(databaseUrl: string): string | undefined {
  const schema = new URL(databaseUrl).searchParams.get("schema");
  if (!schema) return undefined;
  if (!SCHEMA_PATTERN.test(schema)) {
    throw new Error(`DATABASE_URL contains an invalid PostgreSQL schema name: ${schema}`);
  }
  return schema;
}

function createPrismaClient(): PrismaClient {
  const schema = schemaFromUrl(env.DATABASE_URL);

  const adapter = new PrismaPg(
    {
      connectionString: env.DATABASE_URL,
      // Startup parameters are the only way to scope the `pg` pool: Prisma's
      // adapter option qualifies generated queries, but not raw SQL such as
      // the test suite's TRUNCATE.
      ...(schema ? { options: `-c search_path=${schema}` } : {}),
      max: env.DATABASE_POOL_SIZE,
      // Fail fast instead of hanging a request when the database is down.
      connectionTimeoutMillis: 10_000,
      // Recycle idle sockets ourselves before the server (or a NAT/PgBouncer
      // hop) silently drops them.
      idleTimeoutMillis: 30_000,
      maxLifetimeSeconds: 300,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      application_name: "seniorcare-api",
      allowExitOnIdle: env.isTest,
    },
    {
      ...(schema ? { schema } : {}),
      // `pg` emits `error` on the pool when an *idle* backend socket dies
      // (Neon suspends compute after a few idle minutes, laptops sleep, …).
      // Without a listener that is an unhandled EventEmitter error and Node
      // exits, which looks like random "ECONNREFUSED 127.0.0.1:4000" from the
      // Vite proxy. Log it and let the pool reconnect on the next query.
      onPoolError: (error) => {
        log.warn({ err: error }, "idle database connection dropped; the pool will reconnect");
      },
      onConnectionError: (error) => {
        log.warn({ err: error }, "database connection error");
      },
    },
  );

  const client = new PrismaClient({
    adapter,
    log: env.isDevelopment
      ? [
          { emit: "event", level: "warn" },
          { emit: "event", level: "error" },
        ]
      : [{ emit: "event", level: "error" }],
  });

  client.$on("warn" as never, (event: { message: string }) => log.warn({ event }, "prisma warning"));
  client.$on("error" as never, (event: { message: string }) => log.error({ event }, "prisma error"));

  return client;
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (env.isDevelopment) {
  globalForPrisma.prisma = prisma;
}

/** Verify the database connection (used by the readiness probe). */
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    log.error({ err: error }, "database connectivity check failed");
    return false;
  }
}
