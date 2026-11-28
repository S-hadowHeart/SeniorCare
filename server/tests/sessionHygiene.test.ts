import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "../src/config/env.js";
import { runSessionHygieneJob } from "../src/jobs/sessionHygiene.job.js";
import { sha256 } from "../src/lib/crypto.js";
import { prisma } from "../src/lib/prisma.js";
import { closeDatabase, resetDatabase } from "./helpers.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-28T12:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

async function createUser(): Promise<{ id: string }> {
  return prisma.user.create({
    data: {
      email: "hygiene@example.com",
      passwordHash: "unused-in-this-test",
      name: "Hygiene Test",
      role: "CAREGIVER",
      timeZone: "UTC",
    },
    select: { id: true },
  });
}

function token(
  userId: string,
  expiresAt: Date,
  revokedAt: Date | null = null,
): {
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
} {
  return {
    userId,
    tokenHash: sha256(randomUUID()),
    familyId: randomUUID(),
    expiresAt,
    revokedAt,
    revokedReason: revokedAt ? "test" : null,
  };
}

describe("session hygiene job", () => {
  it("removes only sessions and audit rows past their retention window", async () => {
    const user = await createUser();
    const sessionCutoff = new Date(NOW.getTime() - env.SESSION_RETENTION_DAYS * DAY_MS);
    const auditCutoff = new Date(NOW.getTime() - env.AUDIT_RETENTION_DAYS * DAY_MS);

    await prisma.refreshToken.createMany({
      data: [
        // Expired beyond the grace period → removed.
        token(user.id, new Date(sessionCutoff.getTime() - DAY_MS)),
        // Revoked beyond the grace period → removed.
        token(user.id, new Date(NOW.getTime() + 7 * DAY_MS), new Date(sessionCutoff.getTime() - DAY_MS)),
        // Expired but still inside the grace period → kept.
        token(user.id, new Date(sessionCutoff.getTime() + DAY_MS)),
        // Revoked but still inside the grace period → kept.
        token(user.id, new Date(NOW.getTime() + 7 * DAY_MS), new Date(sessionCutoff.getTime() + DAY_MS)),
        // Active → kept.
        token(user.id, new Date(NOW.getTime() + 7 * DAY_MS)),
      ],
    });

    await prisma.auditLog.createMany({
      data: [
        {
          actorId: user.id,
          action: "test.old",
          entity: "Test",
          createdAt: new Date(auditCutoff.getTime() - DAY_MS),
        },
        {
          actorId: user.id,
          action: "test.recent",
          entity: "Test",
          createdAt: new Date(auditCutoff.getTime() + DAY_MS),
        },
      ],
    });

    await expect(runSessionHygieneJob(NOW)).resolves.toEqual({
      refreshTokensDeleted: 2,
      auditLogsDeleted: 1,
    });

    await expect(prisma.refreshToken.count()).resolves.toBe(3);
    const remainingAudit = await prisma.auditLog.findMany({
      select: { action: true },
    });
    expect(remainingAudit.map((row) => row.action)).toEqual(["test.recent"]);

    // Idempotent: a second pass has nothing left to remove.
    await expect(runSessionHygieneJob(NOW)).resolves.toEqual({
      refreshTokensDeleted: 0,
      auditLogsDeleted: 0,
    });
  });

  it("is a no-op on an empty database", async () => {
    await expect(runSessionHygieneJob(NOW)).resolves.toEqual({
      refreshTokensDeleted: 0,
      auditLogsDeleted: 0,
    });
  });
});
