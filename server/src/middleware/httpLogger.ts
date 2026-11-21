import type { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger.js";

/**
 * Structured access log.
 *
 * A small, purpose-built middleware is used instead of `pino-http` so that
 * the log shape is fully under our control (and so that the request id that
 * `requestContext` assigned is always present in the line).
 *
 * Only the metadata needed for operations is logged — never the body, never
 * the query string of a request that may contain personal data.
 */
export interface HttpLoggerOptions {
  /** Requests that match the predicate are not logged. */
  skip?: (req: Request) => boolean;
}

export function httpLogger(options: HttpLoggerOptions = {}): (
  req: Request,
  res: Response,
  next: NextFunction,
) => void {
  return (req, res, next) => {
    if (options.skip?.(req)) {
      next();
      return;
    }

    const startedAt = process.hrtime.bigint();

    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

      const payload = {
        requestId: req.requestId,
        method: req.method,
        path: req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        userId: req.auth?.userId,
        ip: req.ip,
        userAgent: req.header("user-agent")?.slice(0, 200),
      };

      if (res.statusCode >= 500) {
        logger.error(payload, "request failed");
      } else if (res.statusCode >= 400) {
        logger.warn(payload, "request rejected");
      } else {
        logger.info(payload, "request completed");
      }
    });

    next();
  };
}
