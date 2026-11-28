/**
 * Application error hierarchy.
 *
 * Every error that is safe to show to a client extends `AppError` and is
 * rendered as an RFC 9457 (`application/problem+json`) document. Anything
 * that is *not* an `AppError` is treated as an unexpected fault: it is logged
 * with a full stack trace and replaced by a generic 500 response so that
 * internal details (stack traces, SQL, driver messages) never leak.
 */

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code?: string;
  errors?: unknown;
  requestId?: string;
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;
  /** `true` for expected, client-correctable faults. */
  readonly isOperational = true;

  constructor(
    message: string,
    statusCode = 500,
    code = "internal_error",
    details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }

  toProblem(instance?: string, requestId?: string): ProblemDetails {
    const problem: ProblemDetails = {
      type: `https://seniorcare.app/problems/${this.code}`,
      title: this.name,
      status: this.statusCode,
      detail: this.message,
      instance,
      code: this.code,
    };
    if (this.details !== undefined) problem.errors = this.details;
    if (requestId) problem.requestId = requestId;
    return problem;
  }
}

/** 400 — the request body / query failed schema validation. */
export class ValidationError extends AppError {
  constructor(details?: unknown, message = "The request payload is invalid.") {
    super(message, 400, "validation_error", details);
  }
}

/** 401 — missing, malformed or expired credentials. */
export class UnauthorizedError extends AppError {
  constructor(message = "Authentication is required.", code = "unauthorized") {
    super(message, 401, code);
  }
}

/** 403 — authenticated but not allowed to perform the action. */
export class ForbiddenError extends AppError {
  constructor(
    message = "You do not have permission to perform this action.",
    code = "forbidden",
  ) {
    super(message, 403, code);
  }
}

/** 404 — the addressed resource does not exist (or is not visible). */
export class NotFoundError extends AppError {
  constructor(resource = "Resource", code = "not_found") {
    super(`${resource} was not found.`, 404, code);
  }
}

/** 409 — the request conflicts with the current state of the resource. */
export class ConflictError extends AppError {
  constructor(message = "The request conflicts with the current state.", details?: unknown) {
    super(message, 409, "conflict", details);
  }
}

/** 423 — the account is temporarily locked after repeated failed logins. */
export class AccountLockedError extends AppError {
  constructor(retryAfterMinutes: number) {
    super(
      `Too many failed sign-in attempts. Try again in ${retryAfterMinutes} minute(s).`,
      423,
      "account_locked",
      { retryAfterMinutes },
    );
  }
}

/** 429 — rate limit exceeded. */
export class TooManyRequestsError extends AppError {
  constructor(message = "Too many requests. Please slow down.") {
    super(message, 429, "too_many_requests");
  }
}

/** 503 — a downstream dependency is unavailable. */
export class ServiceUnavailableError extends AppError {
  constructor(message = "The service is temporarily unavailable.") {
    super(message, 503, "service_unavailable");
  }
}
