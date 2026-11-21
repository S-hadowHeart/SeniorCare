import type { NextFunction, Request, Response } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { AppError } from "../lib/errors.js";
import { childLogger } from "../lib/logger.js";

const log = childLogger("error-handler");

/**
 * Terminal error middleware.
 *
 * - `AppError` instances are rendered as RFC 9457 problem documents with a
 *   safe, human readable message.
 * - Known Prisma errors are translated into the matching HTTP status.
 * - Everything else is treated as an internal fault: logged with a stack
 *   trace, answered with a generic 500 so that no internals leak.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    return next(error);
  }

  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      log.error({ err: error, requestId: req.requestId }, error.message);
    } else {
      log.info(
        { code: error.code, status: error.statusCode, requestId: req.requestId },
        error.message,
      );
    }

    res.status(error.statusCode).json(error.toProblem(req.originalUrl, req.requestId));
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const mapped = mapPrismaError(error);
    res.status(mapped.status).json({
      type: `https://seniorcare.app/problems/${mapped.code}`,
      title: mapped.title,
      status: mapped.status,
      detail: mapped.detail,
      code: mapped.code,
      requestId: req.requestId,
    });
    return;
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    res.status(400).json({
      type: "https://seniorcare.app/problems/validation_error",
      title: "ValidationError",
      status: 400,
      detail: "The request could not be processed because the data was invalid.",
      code: "validation_error",
      requestId: req.requestId,
    });
    return;
  }

  // Errors raised by body-parser / express itself (malformed JSON, a body
  // that is too large, an unsupported content type …) carry a 4xx status.
  // They are safe to surface — but the message is replaced so that internal
  // details are not leaked.
  const clientError = error as { status?: number; statusCode?: number; type?: string; message?: string };
  const status = clientError.status ?? clientError.statusCode;

  if (typeof status === "number" && status >= 400 && status < 500) {
    const isParseError = clientError.type === "entity.parse.failed";
    res.status(status).json({
      type: `https://seniorcare.app/problems/${isParseError ? "invalid_json" : "bad_request"}`,
      title: isParseError ? "InvalidJsonError" : "BadRequestError",
      status,
      detail: isParseError
        ? "The request body is not valid JSON."
        : "The request could not be processed.",
      code: isParseError ? "invalid_json" : "bad_request",
      requestId: req.requestId,
    });
    return;
  }

  log.error(
    { err: error, requestId: req.requestId, path: req.originalUrl, userId: req.auth?.userId },
    "unhandled error",
  );

  res.status(500).json({
    type: "https://seniorcare.app/problems/internal_error",
    title: "InternalServerError",
    status: 500,
    detail: "An unexpected error occurred. The incident has been logged.",
    code: "internal_error",
    requestId: req.requestId,
  });
}

function mapPrismaError(error: Prisma.PrismaClientKnownRequestError): {
  status: number;
  code: string;
  title: string;
  detail: string;
} {
  switch (error.code) {
    case "P2002": {
      const target = Array.isArray(error.meta?.target)
        ? (error.meta?.target as string[]).join(", ")
        : String(error.meta?.target ?? "field");
      return {
        status: 409,
        code: "conflict",
        title: "ConflictError",
        detail: `A record with the same ${target} already exists.`,
      };
    }
    case "P2003":
      return {
        status: 409,
        code: "conflict",
        title: "ConflictError",
        detail: "The request references a record that does not exist.",
      };
    case "P2025":
      return {
        status: 404,
        code: "not_found",
        title: "NotFoundError",
        detail: "The requested record was not found.",
      };
    default:
      return {
        status: 500,
        code: "internal_error",
        title: "InternalServerError",
        detail: "The request could not be completed.",
      };
  }
}

/** 404 handler for unmatched routes. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    type: "https://seniorcare.app/problems/not_found",
    title: "NotFoundError",
    status: 404,
    detail: `No route matches ${req.method} ${req.originalUrl}.`,
    code: "not_found",
    requestId: req.requestId,
  });
}
