import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { ok } from "../../lib/http.js";
import { checkDatabaseConnection } from "../../lib/prisma.js";
import { sseHub } from "../../realtime/sse.js";
import { env } from "../../config/env.js";

export const healthRouter = Router();

const startedAt = Date.now();

/**
 * GET /api/v1/health — liveness probe.
 *
 * Answers as long as the process is running. It deliberately does *not* touch
 * the database so that a transient database outage does not cause the
 * orchestrator to kill an otherwise healthy process.
 */
healthRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    ok(res, {
      status: "ok",
      service: "seniorcare-api",
      environment: env.NODE_ENV,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      sseConnections: sseHub.connectionCount,
      timestamp: new Date().toISOString(),
    });
  }),
);

/**
 * GET /api/v1/health/ready — readiness probe.
 *
 * Verifies that the database is reachable, so that a rolling deployment does
 * not send traffic to an instance that cannot serve it.
 */
healthRouter.get(
  "/ready",
  asyncHandler(async (_req, res) => {
    const databaseOk = await checkDatabaseConnection();

    if (!databaseOk) {
      res.status(503).json({
        type: "https://seniorcare.app/problems/service_unavailable",
        title: "ServiceUnavailableError",
        status: 503,
        detail: "The database is not reachable.",
        code: "service_unavailable",
      });
      return;
    }

    ok(res, { status: "ready", database: "up" });
  }),
);
