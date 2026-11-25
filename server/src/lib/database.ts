const SCHEMA_PATTERN = /^[a-z_][a-z0-9_]*$/i;

export interface DatabaseSchemaScope {
  /** The schema named by `?schema=`, if the URL asks for one. */
  schema: string | undefined;
  /** Extra `pg` pool options: scopes raw SQL to the same schema. */
  pool: { options?: string };
  /** Extra driver-adapter options: scopes generated queries to the schema. */
  adapter: { schema?: string };
}

/**
 * Resolve the PostgreSQL schema named by a `?schema=` query parameter.
 *
 * Prisma's CLI honours the parameter, but `pg` — and therefore the driver
 * adapter — does not: a client pointed at
 * `postgres://…/db?schema=seniorcare_test` still resolves unqualified names
 * against `public`. Applying the name in both places keeps generated queries
 * and raw SQL (such as the test suite's TRUNCATE) on the same schema.
 *
 * The name is validated because it is spliced into a server startup
 * parameter, where a stray quote or semicolon would become configuration.
 */
export function resolveDatabaseSchema(databaseUrl: string): DatabaseSchemaScope {
  const schema = new URL(databaseUrl).searchParams.get("schema") ?? undefined;

  if (schema && !SCHEMA_PATTERN.test(schema)) {
    throw new Error(`DATABASE_URL contains an invalid PostgreSQL schema name: ${schema}`);
  }

  return {
    schema,
    pool: schema ? { options: `-c search_path=${schema}` } : {},
    adapter: schema ? { schema } : {},
  };
}
