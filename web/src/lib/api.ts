/**
 * Typed API client.
 *
 * Responsibilities
 * ----------------
 * * Holds the short-lived access token **in memory only** (never in
 *   `localStorage`, where it would be readable by any injected script).
 * * Performs the refresh-token dance automatically: a `401` triggers a
 *   single-flight refresh (concurrent 401s share one refresh call) and the
 *   original request is replayed once.
 * * Normalises every error into an `ApiError` carrying the RFC 9457 problem
 *   details returned by the server, so the UI can show field-level messages.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  code?: string;
  errors?: unknown;
  requestId?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly errors?: unknown;
  readonly requestId?: string;

  constructor(status: number, problem: ProblemDetails) {
    super(problem.detail ?? problem.title ?? "Something went wrong.");
    this.name = "ApiError";
    this.status = status;
    this.code = problem.code ?? "unknown_error";
    this.errors = problem.errors;
    this.requestId = problem.requestId;
  }

  /** Field-level validation messages, keyed by field name. */
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.errors)) return {};
    const result: Record<string, string> = {};
    for (const issue of this.errors as Array<{ path?: string; message?: string }>) {
      if (issue.path && issue.message && !result[issue.path]) {
        result[issue.path] = issue.message;
      }
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// Access token store (module scoped → not persisted anywhere)
// ---------------------------------------------------------------------------

let accessToken: string | null = null;
let onSessionExpired: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

// ---------------------------------------------------------------------------
// Refresh (single flight)
// ---------------------------------------------------------------------------

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const response = await fetch(`${API_BASE}/auth/refresh`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        });

        if (!response.ok) {
          onSessionExpired?.();
          return null;
        }

        const payload = (await response.json()) as { data?: { accessToken?: string } };
        const token = payload.data?.accessToken ?? null;
        if (token) accessToken = token;
        return token;
      } catch {
        onSessionExpired?.();
        return null;
      } finally {
        // Allow a new refresh on the next 401.
        setTimeout(() => {
          refreshInFlight = null;
        }, 0);
      }
    })();
  }

  return refreshInFlight;
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

interface RequestOptions {
  body?: unknown;
  signal?: AbortSignal;
  /** Internal: prevents an infinite refresh loop. */
  allowRetry?: boolean;
  headers?: Record<string, string>;
}

async function request<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...options.headers,
  };

  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    credentials: "include",
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });

  if (response.status === 204) return undefined as T;

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (response.ok) {
    // Unwrap `{ data: ... }` envelopes, but keep a legitimate `data: null`
    // (e.g. "no location recorded yet") instead of falling back to the
    // envelope itself.
    if (payload && typeof payload === "object" && "data" in payload) {
      return (payload as { data: T }).data;
    }
    return payload as T;
  }

  // 401 → try to refresh once, then replay the request.
  if (response.status === 401 && options.allowRetry !== false) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return request<T>(method, path, { ...options, allowRetry: false });
    }
    onSessionExpired?.();
  }

  const problem = (payload ?? {}) as ProblemDetails;
  throw new ApiError(response.status, {
    ...problem,
    status: problem.status ?? response.status,
  });
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, "body">) =>
    request<T>("GET", path, { ...options }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "body">) =>
    request<T>("POST", path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "body">) =>
    request<T>("PATCH", path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "body">) =>
    request<T>("PUT", path, { ...options, body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, "body">) =>
    request<T>("DELETE", path, options),
  refresh: refreshAccessToken,
};
