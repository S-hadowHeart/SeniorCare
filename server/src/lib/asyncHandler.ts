import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Wraps an async Express handler so that rejected promises are forwarded to
 * the error middleware instead of becoming unhandled rejections.
 *
 * Express 5 already forwards rejected promises, but keeping this helper makes
 * the intent explicit and keeps the handlers type-safe.
 */
export function asyncHandler<T>(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<T>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
