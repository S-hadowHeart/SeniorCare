import { Router, type Request, type Response } from "express";
import { env } from "../../config/env.js";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { created, ok } from "../../lib/http.js";
import { UnauthorizedError } from "../../lib/errors.js";
import { authenticate } from "../../middleware/authenticate.js";
import {
  assertCsrf,
  clearCsrfCookie,
  issueCsrfToken,
  setCsrfCookie,
} from "../../middleware/csrf.js";
import { authLimiter } from "../../middleware/rateLimit.js";
import { validate, validatedBody } from "../../middleware/validate.js";
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  type ChangePasswordInput,
  type LoginInput,
  type RegisterInput,
} from "./auth.schemas.js";
import {
  REFRESH_COOKIE_NAME,
  changePassword,
  getProfile,
  login,
  register,
  revokeAllSessions,
  revokeRefreshToken,
  rotateRefreshToken,
  writeAuditLog,
} from "./auth.service.js";

export const authRouter = Router();

const REFRESH_COOKIE_PATH = "/api/v1/auth";

function sessionContext(req: Request): { ipAddress?: string; userAgent?: string } {
  return {
    ipAddress: req.ip,
    userAgent: req.header("user-agent"),
  };
}

function setSessionCookies(res: Response, refreshToken: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "strict",
    path: REFRESH_COOKIE_PATH,
    expires: expiresAt,
  });
  // A fresh CSRF token is issued with every new session and rotated with every
  // refresh, so a token from an old session cannot be replayed.
  setCsrfCookie(res, issueCsrfToken(), expiresAt);
}

function clearSessionCookies(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "strict",
    path: REFRESH_COOKIE_PATH,
  });
  clearCsrfCookie(res);
}

/** POST /api/v1/auth/register — create an account. */
authRouter.post(
  "/register",
  authLimiter,
  validate({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const input = validatedBody<RegisterInput>(req);
    const result = await register(input, sessionContext(req));

    setSessionCookies(res, result.tokens.refreshToken, result.tokens.refreshTokenExpiresAt);

    await writeAuditLog({
      actorId: result.id,
      action: "auth.register",
      entity: "User",
      entityId: result.id,
      ipAddress: req.ip,
      userAgent: req.header("user-agent"),
    });

    created(res, {
      user: {
        id: result.id,
        email: result.email,
        name: result.name,
        role: result.role,
        timeZone: result.timeZone,
        elderId: result.elderId,
      },
      accessToken: result.tokens.accessToken,
      expiresIn: result.tokens.accessTokenExpiresIn,
    });
  }),
);

/** POST /api/v1/auth/login — exchange credentials for a session. */
authRouter.post(
  "/login",
  authLimiter,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const input = validatedBody<LoginInput>(req);
    const result = await login(input, sessionContext(req));

    setSessionCookies(res, result.tokens.refreshToken, result.tokens.refreshTokenExpiresAt);

    await writeAuditLog({
      actorId: result.id,
      action: "auth.login",
      entity: "User",
      entityId: result.id,
      ipAddress: req.ip,
      userAgent: req.header("user-agent"),
    });

    ok(res, {
      user: {
        id: result.id,
        email: result.email,
        name: result.name,
        role: result.role,
        timeZone: result.timeZone,
        elderId: result.elderId,
      },
      accessToken: result.tokens.accessToken,
      expiresIn: result.tokens.accessTokenExpiresIn,
    });
  }),
);

/**
 * POST /api/v1/auth/refresh — rotate the refresh token.
 *
 * The refresh token lives in an httpOnly, SameSite=Strict cookie. The
 * double-submit CSRF check is a second, independent barrier: the request must
 * also echo the `sc_csrf` cookie in `X-CSRF-Token`.
 */
authRouter.post(
  "/refresh",
  authLimiter,
  asyncHandler(async (req, res) => {
    const rawToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;

    if (!rawToken) {
      throw new UnauthorizedError("No active session.", "no_refresh_token");
    }

    assertCsrf(req);

    const result = await rotateRefreshToken(rawToken, sessionContext(req));

    setSessionCookies(res, result.refreshToken, result.refreshTokenExpiresAt);

    ok(res, {
      user: result.user,
      accessToken: result.accessToken,
      expiresIn: result.accessTokenExpiresIn,
    });
  }),
);

/** POST /api/v1/auth/logout — revoke the current session. */
authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const rawToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
    if (rawToken) {
      // A cross-site logout is only a nuisance, but it is still a state
      // change, so it gets the same token check as refresh.
      assertCsrf(req);
      await revokeRefreshToken(rawToken);
    }
    clearSessionCookies(res);
    ok(res, { message: "Signed out." });
  }),
);

/** POST /api/v1/auth/logout-all — revoke every session of the caller. */
authRouter.post(
  "/logout-all",
  authenticate,
  asyncHandler(async (req, res) => {
    const revoked = await revokeAllSessions(req.auth!.userId, "signed_out_everywhere");
    clearSessionCookies(res);
    ok(res, { revokedSessions: revoked });
  }),
);

/** GET /api/v1/auth/me — the authenticated profile. */
authRouter.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    const profile = await getProfile(req.auth!.userId);
    ok(res, profile);
  }),
);

/** POST /api/v1/auth/change-password — rotate the password. */
authRouter.post(
  "/change-password",
  authenticate,
  validate({ body: changePasswordSchema }),
  asyncHandler(async (req, res) => {
    const input = validatedBody<ChangePasswordInput>(req);
    await changePassword(req.auth!.userId, input, sessionContext(req));
    clearSessionCookies(res);
    ok(res, { message: "Password updated. Please sign in again." });
  }),
);
