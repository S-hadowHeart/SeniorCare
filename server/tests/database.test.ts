import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";

/**
 * The test suites truncate every table, so they must only ever touch the
 * schema named by `TEST_DATABASE_URL`. Prisma's CLI honours `?schema=`, but
 * the `pg` driver adapter does not unless the name is applied explicitly —
 * this test fails if a client silently falls back to `public`.
 */
describe("test database isolation", () => {
  it("connects to the schema named in TEST_DATABASE_URL", async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) throw new Error("TEST_DATABASE_URL is not set.");
    const configured = new URL(url).searchParams.get("schema") ?? "public";

    const rows = await prisma.$queryRaw<
      { current_schema: string }[]
    >`SELECT current_schema() AS current_schema`;

    expect(rows[0]?.current_schema).toBe(configured);
  });
});
