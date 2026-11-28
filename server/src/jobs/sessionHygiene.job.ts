import { env } from "../config/env.js";
import { childLogger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";

const log = childLogger("job:session-hygiene");

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SessionHygieneResult {
  refreshTokensDeleted: number;
  auditLogsDeleted: number;
}

/**
 * Daily retention job.
 *
 * Expired and revoked refresh tokens are kept for a grace period so that a
 * replayed-token investigation can still see the family history; audit rows
 * are retained for a year by default. Only rows that are older than the
 * configured cutoff are removed, which makes the job idempotent and safe to
 * re-run after a failed or partial pass.
 */
export async function runSessionHygieneJob(now: Date = new Date()): Promise<SessionHygieneResult> {
  const tokenCutoff = new Date(now.getTime() - env.SESSION_RETENTION_DAYS * DAY_MS);
  const auditCutoff = new Date(now.getTime() - env.AUDIT_RETENTION_DAYS * DAY_MS);

  const [tokens, auditLogs] = await Promise.all([
    prisma.refreshToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: tokenCutoff } },
          { revokedAt: { not: null, lt: tokenCutoff } },
        ],
      },
    }),
    prisma.auditLog.deleteMany({
      where: { createdAt: { lt: auditCutoff } },
    }),
  ]);

  if (tokens.count > 0 || auditLogs.count > 0) {
    log.info(
      { refreshTokensDeleted: tokens.count, auditLogsDeleted: auditLogs.count },
      "session hygiene complete",
    );
  }

  return {
    refreshTokensDeleted: tokens.count,
    auditLogsDeleted: auditLogs.count,
  };
}
