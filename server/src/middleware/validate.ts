import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { ValidationError } from "../lib/errors.js";

interface ValidationSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

function formatIssues(error: unknown): Array<{ path: string; message: string; code?: string }> {
  const issues = (error as { issues?: Array<{ path: (string | number)[]; message: string; code?: string }> })
    .issues;

  if (!Array.isArray(issues)) return [];

  return issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Request validation middleware.
 *
 * All input that crosses the trust boundary is parsed with a Zod schema
 * before it reaches a service. The parsed (and therefore normalised) value
 * is exposed through `req.validated`, never the raw request object, so that
 * a handler can never accidentally read an unvalidated field.
 *
 * Unknown keys are stripped by Zod's default `strip` behaviour, which also
 * prevents mass-assignment attacks (e.g. a client posting `role: "ADMIN"`).
 */
export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.validated = {};

      if (schemas.params) {
        const result = schemas.params.safeParse(req.params);
        if (!result.success) {
          throw new ValidationError(formatIssues(result.error), "Invalid URL parameters.");
        }
        req.validated.params = result.data;
      }

      if (schemas.query) {
        const result = schemas.query.safeParse(req.query);
        if (!result.success) {
          throw new ValidationError(formatIssues(result.error), "Invalid query parameters.");
        }
        req.validated.query = result.data;
      }

      if (schemas.body) {
        const result = schemas.body.safeParse(req.body);
        if (!result.success) {
          throw new ValidationError(formatIssues(result.error));
        }
        req.validated.body = result.data;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Typed accessors for the validated payload. */
export function validatedBody<T>(req: Request): T {
  return req.validated.body as T;
}

export function validatedQuery<T>(req: Request): T {
  return req.validated.query as T;
}

export function validatedParams<T>(req: Request): T {
  return req.validated.params as T;
}
