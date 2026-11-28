import type { Request, Response } from "express";
import { env } from "../config/env.js";
import { generateOpaqueToken, safeEqual } from "../lib/crypto.js";
import { ForbiddenError } from "../lib/errors.js";

/**
 * Double-submit CSRF defence for the cookie-authenticated auth endpoints.
 *
 * The refresh token is already `SameSite=Strict`, which blocks most cross-site
 * form posts. This adds a second, independent check: a random token is issued
 * in a JavaScript-readable cookie, the SPA echoes it in `X-CSRF-Token`, and the
 * server compares the two in constant time. An attacker who can make a
 * cross-origin request cannot read the cookie (same-origin policy) and cannot
 * set the custom header without a successful CORS preflight.
 *
 * The cookie path is `/` so the SPA can read it; the refresh cookie remains
 * scoped to `/api/v1/auth`.
 */
export const CSRF_COOKIE_NAME = "sc_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";
export const CSRF_COOKIE_PATH = "/";

export function issueCsrfToken(): string {
  return generateOpaqueToken(32);
}

export function setCsrfCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    secure: env.isProduction,
    sameSite: "strict",
    path: CSRF_COOKIE_PATH,
    expires: expiresAt,
  });
}

export function clearCsrfCookie(res: Response): void {
  res.clearCookie(CSRF_COOKIE_NAME, {
    httpOnly: false,
    secure: env.isProduction,
    sameSite: "strict",
    path: CSRF_COOKIE_PATH,
  });
}

/** Throw a 403 unless the header matches the cookie. */
export function assertCsrf(req: Request): void {
  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME] as string | undefined;
  const headerToken = req.get(CSRF_HEADER_NAME);

  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
    throw new ForbiddenError(
      "The CSRF token is missing or does not match. Refresh the page and try again.",
      "csrf_token_invalid",
    );
  }
}
