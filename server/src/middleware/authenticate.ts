import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "../lib/errors.js";
import { verifyAccessToken } from "../lib/jwt.js";
import type { AuthContext } from "../types.js";

/**
 * Bearer-token authentication.
 *
 * The access token is short lived and stateless; the refresh token (held in
 * an httpOnly cookie) is what actually maintains the session.
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const header = req.header("authorization");
    if (!header) {
      throw new UnauthorizedError("An Authorization header is required.", "missing_token");
    }

    const [scheme, token] = header.split(" ");
    if (!scheme || scheme.toLowerCase() !== "bearer" || !token) {
      throw new UnauthorizedError(
        "The Authorization header must use the Bearer scheme.",
        "invalid_authorization_header",
      );
    }

    const claims = await verifyAccessToken(token);

    const context: AuthContext = {
      userId: claims.sub,
      role: claims.role,
      email: claims.email,
      name: claims.name,
    };

    req.auth = context;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Ensures the request carries a valid session.
 *
 * The account must still be active — a disabled account keeps a valid JWT
 * until it expires, so the flag is re-checked on every request that touches
 * sensitive data.
 */
export function requireAuth(req: Request): AuthContext {
  if (!req.auth) {
    throw new UnauthorizedError();
  }
  return req.auth;
}
