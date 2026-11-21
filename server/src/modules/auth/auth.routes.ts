import { Router, type Request, type Response } from "express";
import { env } from "../../config/env.js";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { created, ok } from "../../lib/http.js";
import { UnauthorizedError } from "../../lib/errors.js";
import { authenticate } from "../../middleware/authenticate.js";
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

function setRefreshCookie(res: Response, refreshToken: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "strict",
    path: REFRESH_COOKIE_PATH,
    expires: expiresAt,
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "strict",
    path: REFRESH_COOKIE_PATH,
  });
}

/** POST /api/v1/auth/register — create an account. */
authRouter.post(
  "/register",
  authLimiter,
  validate({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const input = validatedBody<RegisterInput>(req);
    const result = await register(input, sessionContext(req));

    setRefreshCookie(res, result.tokens.refreshToken, result.tokens.refreshTokenExpiresAt);

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

    setRefreshCookie(res, result.tokens.refreshToken, result.tokens.refreshTokenExpiresAt);

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
 * The refresh token lives in an httpOnly, SameSite=Strict cookie, so this
 * endpoint cannot be triggered cross-site.
 */
authRouter.post(
  "/refresh",
  authLimiter,
  asyncHandler(async (req, res) => {
    const rawToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;

    if (!rawToken) {
      throw new UnauthorizedError("No active session.", "no_refresh_token");
    }

    const result = await rotateRefreshToken(rawToken, sessionContext(req));

    setRefreshCookie(res, result.refreshToken, result.refreshTokenExpiresAt);

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
      await revokeRefreshToken(rawToken);
    }
    clearRefreshCookie(res);
    ok(res, { message: "Signed out." });
  }),
);

/** POST /api/v1/auth/logout-all — revoke every session of the caller. */
authRouter.post(
  "/logout-all",
  authenticate,
  asyncHandler(async (req, res) => {
    const revoked = await revokeAllSessions(req.auth!.userId, "signed_out_everywhere");
    clearRefreshCookie(res);
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
    clearRefreshCookie(res);
    ok(res, { message: "Password updated. Please sign in again." });
  }),
);
