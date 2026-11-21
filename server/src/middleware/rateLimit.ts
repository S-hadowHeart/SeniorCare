import rateLimit, { ipKeyGenerator, type Options } from "express-rate-limit";
import type { Request, Response } from "express";
import { env } from "../config/env.js";
import { childLogger } from "../lib/logger.js";

const log = childLogger("rate-limit");

function buildHandler(
  scope: string,
): (req: Request, res: Response, next: (err?: unknown) => void) => void {
  return (req, res, _next) => {
    log.warn(
      {
        scope,
        requestId: req.requestId,
        ip: req.ip,
        path: req.originalUrl,
        userId: req.auth?.userId,
      },
      "rate limit exceeded",
    );
    res.status(429).json({
      type: "https://seniorcare.app/problems/too_many_requests",
      title: "TooManyRequestsError",
      status: 429,
      detail: "Too many requests. Please slow down and try again shortly.",
      code: "too_many_requests",
      requestId: req.requestId,
    });
  };
}

const shared: Partial<Options> = {
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // Disabled in tests so that suites are not rate limited.
  skip: () => env.isTest,
};

/**
 * Rate limit key.
 *
 * Authenticated callers are keyed by their user id so that several people
 * behind the same NAT do not share a bucket. Anonymous callers are keyed by
 * their IP — normalised through `ipKeyGenerator` so that a single IPv6
 * address cannot rotate through its /64 subnet to bypass the limit.
 */
function keyGenerator(req: Request): string {
  return req.auth?.userId ?? ipKeyGenerator(req.ip ?? "unknown");
}

/**
 * Global limiter — a broad safety net for the whole API surface.
 */
export const globalLimiter = rateLimit({
  ...shared,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  keyGenerator,
  handler: buildHandler("global"),
});

/** Strict limiter for credential endpoints (login / register / refresh). */
export const authLimiter = rateLimit({
  ...shared,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  skipSuccessfulRequests: true,
  handler: buildHandler("auth"),
});

/**
 * Limiter for the SOS endpoint. SOS is a safety-critical feature, so the
 * limit is generous — it exists to stop a stuck button from flooding the
 * caregivers, not to block a genuine emergency.
 */
export const sosLimiter = rateLimit({
  ...shared,
  windowMs: 60_000,
  limit: env.SOS_RATE_LIMIT_MAX,
  keyGenerator,
  handler: buildHandler("sos"),
});

/** Limiter for outbound e-mail heavy endpoints. */
export const notificationLimiter = rateLimit({
  ...shared,
  windowMs: 60_000,
  limit: 10,
  keyGenerator,
  handler: buildHandler("notification"),
});
