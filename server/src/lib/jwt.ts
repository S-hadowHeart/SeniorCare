import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { env } from "../config/env.js";
import { UnauthorizedError } from "./errors.js";
import type { Role } from "../generated/prisma/enums.js";

/**
 * Access tokens are stateless JWTs (HS256).
 *
 * The refresh token — which is the credential that actually grants a long
 * lived session — is an opaque random string stored hashed in the database,
 * so it can be revoked. The access token is intentionally short lived
 * (15 minutes by default) to bound the damage of a leaked token.
 */

const secret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

export interface AccessTokenClaims {
  /** User id. */
  sub: string;
  role: Role;
  email: string;
  name: string;
  /** Unique token id — allows future per-token revocation lists. */
  jti: string;
}

export interface VerifiedAccessToken extends AccessTokenClaims {
  iat: number;
  exp: number;
}

export async function signAccessToken(claims: Omit<AccessTokenClaims, "jti">): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);

  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.sub)
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setJti(crypto.randomUUID())
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + env.ACCESS_TOKEN_TTL_SECONDS)
    .sign(secret);
}

/**
 * Verify an access token.
 * Throws {@link UnauthorizedError} for every failure mode so that callers
 * cannot distinguish "expired" from "forged" from "wrong audience".
 */
export async function verifyAccessToken(token: string): Promise<VerifiedAccessToken> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      algorithms: ["HS256"],
    });

    if (!payload.sub || typeof payload.role !== "string") {
      throw new UnauthorizedError("The access token is malformed.", "invalid_token");
    }

    return {
      sub: payload.sub,
      role: payload.role as Role,
      email: String(payload.email ?? ""),
      name: String(payload.name ?? ""),
      jti: String(payload.jti ?? ""),
      iat: payload.iat ?? 0,
      exp: payload.exp ?? 0,
    };
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    throw new UnauthorizedError("The access token is invalid or has expired.", "invalid_token");
  }
}

/** Decode without verifying — only used for logging/diagnostics. */
export function decodeAccessToken(token: string): JWTPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString("utf8")) as JWTPayload;
  } catch {
    return null;
  }
}
