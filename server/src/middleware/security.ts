import cors from "cors";
import helmet from "helmet";
import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { ForbiddenError } from "../lib/errors.js";

/**
 * HTTP hardening.
 *
 * The API only ever returns JSON, so the Content-Security-Policy can be
 * extremely restrictive (`default-src 'none'`). The React application is
 * served separately (by nginx in production) and carries its own CSP — see
 * `deploy/nginx.conf`.
 */
export const securityHeaders: RequestHandler = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
      frameAncestors: ["'none'"],
      sandbox: ["allow-same-origin"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "same-site" },
  referrerPolicy: { policy: "no-referrer" },
  // HSTS is only meaningful (and safe) over TLS in production.
  hsts: env.isProduction
    ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
    : false,
  frameguard: { action: "deny" },
  noSniff: true,
  xssFilter: true,
});

const allowedOrigins = new Set(env.CORS_ORIGINS);

/**
 * CORS.
 *
 * Only explicitly allow-listed origins may send credentialed requests. The
 * `Vary: Origin` header is set so that shared caches never serve a response
 * that was generated for a different origin.
 */
export const corsMiddleware: RequestHandler = cors({
  origin(origin, callback) {
    // Same-origin requests, server-to-server calls and `curl` have no Origin.
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(origin)) return callback(null, true);

    // A rejected origin is a client error, not a server fault: answer with a
    // clean 403 problem document instead of letting it become a 500.
    return callback(
      new ForbiddenError(`Origin ${origin} is not allowed by the CORS policy.`),
    );
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id", "X-CSRF-Token"],
  exposedHeaders: ["X-Request-Id", "RateLimit", "RateLimit-Policy"],
  maxAge: 600,
});
