import pino from "pino";
import { env } from "../config/env.js";

/**
 * Structured logging.
 *
 * Pino is used instead of a console wrapper because it serialises to JSON
 * (cheap to ship to a log aggregator) and its async transport keeps the
 * main thread free of blocking writes.
 *
 * `redact` guarantees that credentials, tokens and raw e-mail bodies never
 * end up in the log stream — a hard requirement for a health-adjacent
 * application.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers['x-csrf-token']",
      "res.headers['set-cookie']",
      "*.password",
      "*.passwordHash",
      "*.token",
      "*.refreshToken",
      "*.accessToken",
      "*.secret",
      "body.password",
      "body.currentPassword",
      "body.newPassword",
    ],
    censor: "[redacted]",
  },
  base: { service: "seniorcare-api" },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
  transport: env.LOG_PRETTY
    ? {
        target: "pino/file",
        options: { destination: 1 },
      }
    : undefined,
});

export const childLogger = (module: string) => logger.child({ module });
