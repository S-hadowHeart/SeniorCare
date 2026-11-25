import { describe, expect, it } from "vitest";
import { resolveDatabaseSchema } from "../src/lib/database.js";

describe("resolveDatabaseSchema", () => {
  it("leaves the connection unchanged when the URL names no schema", () => {
    const scope = resolveDatabaseSchema("postgresql://user:pass@host:5432/seniorcare");

    expect(scope.schema).toBeUndefined();
    expect(scope.pool).toEqual({});
    expect(scope.adapter).toEqual({});
  });

  it("scopes generated queries and raw SQL to the named schema", () => {
    const scope = resolveDatabaseSchema(
      "postgresql://user:pass@host:5432/seniorcare?schema=seniorcare_test",
    );

    expect(scope.schema).toBe("seniorcare_test");
    expect(scope.pool).toEqual({ options: "-c search_path=seniorcare_test" });
    expect(scope.adapter).toEqual({ schema: "seniorcare_test" });
  });

  it("rejects a schema name that could alter the connection options", () => {
    expect(() =>
      resolveDatabaseSchema(
        "postgresql://user:pass@host:5432/seniorcare?schema=public%3Bselect%201",
      ),
    ).toThrow("invalid PostgreSQL schema name");
  });
});
