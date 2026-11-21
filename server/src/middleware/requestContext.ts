import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Assigns a correlation id to every request.
 *
 * The id is echoed back in the `x-request-id` response header and included in
 * every log line and error payload, which makes it possible to trace a user
 * report ("I saw request 8f2c…") through the logs and the audit trail.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header("x-request-id");
  const requestId = incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();

  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);

  next();
}
