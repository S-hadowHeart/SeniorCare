import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { AccountLockedError, ConflictError, UnauthorizedError, ValidationError } from "../../lib/errors.js";
import {
  generateOpaqueToken,
  hashPassword,
  normalizeEmail,
  sha256,
  verifyPassword,
} from "../../lib/crypto.js";
import { signAccessToken } from "../../lib/jwt.js";
import { prisma } from "../../lib/prisma.js";
import { childLogger } from "../../lib/logger.js";
import type { ChangePasswordInput, LoginInput, RegisterInput } from "./auth.schemas.js";
import { notify } from "../../notifications/service.js";

const log = childLogger("auth");

export const REFRESH_COOKIE_NAME = "sc_refresh";

export interface SessionContext {
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

export interface TokenPair {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: string;
  timeZone: string;
  elderId: string | null;
}

/**
 * A dummy Argon2id hash used to equalise the response time of a login
 * attempt for an unknown e-mail address. Without it, "user does not exist"
 * would be measurably faster than "wrong password", which is a user
 * enumeration oracle.
 */
let dummyHashPromise: Promise<string> | null = null;

function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(`dummy-${randomUUID()}`);
  return dummyHashPromise;
}

/** Create an account together with (for seniors) the elder health profile. */
export async function register(input: RegisterInput, ctx: SessionContext): Promise<AuthenticatedUser & { tokens: TokenPair }> {
  const email = normalizeEmail(input.email);

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    throw new ConflictError("An account with this e-mail address already exists.", {
      field: "email",
    });
  }

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name: input.name.trim(),
      phone: input.phone ?? null,
      role: input.role,
      timeZone: input.timeZone,
      ...(input.role === "SENIOR"
        ? {
            elderProfile: {
              create: {
                displayName: input.elder?.displayName?.trim() || input.name.trim(),
                dateOfBirth: input.elder?.dateOfBirth ?? null,
                bloodType: input.elder?.bloodType ?? "UNKNOWN",
                conditions: input.elder?.conditions ?? [],
              },
            },
          }
        : {}),
    },
    include: { elderProfile: { select: { id: true } } },
  });

  log.info({ userId: user.id, role: user.role }, "account created");

  const tokens = await issueSession(user.id, user.email, user.name, user.role, ctx);

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    timeZone: user.timeZone,
    elderId: user.elderProfile?.id ?? null,
    tokens,
  };
}

/** Verify credentials and issue a new session. */
export async function login(input: LoginInput, ctx: SessionContext): Promise<AuthenticatedUser & { tokens: TokenPair }> {
  const email = normalizeEmail(input.email);
  const user = await prisma.user.findUnique({
    where: { email },
    include: { elderProfile: { select: { id: true } } },
  });

  if (!user) {
    // Burn a comparable amount of CPU so the response time does not reveal
    // whether the account exists.
    await verifyPassword(input.password, await getDummyHash());
    throw new UnauthorizedError("E-mail address or password is incorrect.", "invalid_credentials");
  }

  if (!user.isActive) {
    throw new UnauthorizedError("This account has been deactivated.", "account_disabled");
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000));
    throw new AccountLockedError(minutes);
  }

  const passwordMatches = await verifyPassword(input.password, user.passwordHash);

  if (!passwordMatches) {
    const attempts = user.failedLogins + 1;
    const shouldLock = attempts >= env.MAX_FAILED_LOGINS;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLogins: shouldLock ? 0 : attempts,
        lockedUntil: shouldLock ? new Date(Date.now() + env.LOCKOUT_MINUTES * 60_000) : null,
      },
    });

    log.warn(
      { userId: user.id, attempts, locked: shouldLock, ip: ctx.ipAddress },
      "failed sign-in attempt",
    );

    if (shouldLock) {
      throw new AccountLockedError(env.LOCKOUT_MINUTES);
    }

    throw new UnauthorizedError("E-mail address or password is incorrect.", "invalid_credentials");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  const tokens = await issueSession(user.id, user.email, user.name, user.role, ctx);

  log.info({ userId: user.id, ip: ctx.ipAddress }, "signed in");

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    timeZone: user.timeZone,
    elderId: user.elderProfile?.id ?? null,
    tokens,
  };
}

/**
 * Issue an access token plus a brand new refresh-token family.
 */
export async function issueSession(
  userId: string,
  email: string,
  name: string,
  role: string,
  ctx: SessionContext,
  familyId: string = randomUUID(),
): Promise<TokenPair> {
  const accessToken = await signAccessToken({
    sub: userId,
    role: role as never,
    email,
    name,
  });

  const refreshToken = generateOpaqueToken(32);
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256(refreshToken),
      familyId,
      expiresAt,
      userAgent: ctx.userAgent?.slice(0, 300) ?? null,
      ipAddress: ctx.ipAddress?.slice(0, 64) ?? null,
    },
  });

  return {
    accessToken,
    accessTokenExpiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    refreshToken,
    refreshTokenExpiresAt: expiresAt,
  };
}

/**
 * Rotate a refresh token.
 *
 * Refresh tokens are single use. Presenting an already rotated token is
 * treated as a possible theft: the entire token family is revoked and the
 * user has to sign in again.
 */
export async function rotateRefreshToken(
  rawToken: string,
  ctx: SessionContext,
): Promise<TokenPair & { user: AuthenticatedUser }> {
  const tokenHash = sha256(rawToken);
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: { include: { elderProfile: { select: { id: true } } } } },
  });

  if (!record) {
    throw new UnauthorizedError("The session is no longer valid. Please sign in again.", "invalid_refresh_token");
  }

  if (record.revokedAt) {
    // Replay of a revoked token → assume compromise, kill the whole family.
    await prisma.refreshToken.updateMany({
      where: { familyId: record.familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "reuse_detected" },
    });

    log.error(
      { userId: record.userId, familyId: record.familyId, ip: ctx.ipAddress },
      "refresh token reuse detected — session family revoked",
    );

    throw new UnauthorizedError(
      "The session was invalidated for security reasons. Please sign in again.",
      "refresh_token_reuse",
    );
  }

  if (record.expiresAt.getTime() < Date.now()) {
    throw new UnauthorizedError("The session has expired. Please sign in again.", "refresh_token_expired");
  }

  if (!record.user.isActive) {
    throw new UnauthorizedError("This account has been deactivated.", "account_disabled");
  }

  await prisma.refreshToken.update({
    where: { id: record.id },
    data: { revokedAt: new Date(), revokedReason: "rotated" },
  });

  const tokens = await issueSession(
    record.user.id,
    record.user.email,
    record.user.name,
    record.user.role,
    ctx,
    record.familyId,
  );

  return {
    ...tokens,
    user: {
      id: record.user.id,
      email: record.user.email,
      name: record.user.name,
      role: record.user.role,
      timeZone: record.user.timeZone,
      elderId: record.user.elderProfile?.id ?? null,
    },
  };
}

/** Revoke a single refresh token (sign out). */
export async function revokeRefreshToken(rawToken: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: sha256(rawToken), revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: "signed_out" },
  });
}

/** Revoke every active session of a user (password change, "sign out all"). */
export async function revokeAllSessions(userId: string, reason = "revoked_by_user"): Promise<number> {
  const result = await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return result.count;
}

/** Change the password and invalidate every other session. */
export async function changePassword(
  userId: string,
  input: ChangePasswordInput,
  ctx: SessionContext,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true },
  });

  if (!user) {
    throw new UnauthorizedError();
  }

  const matches = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!matches) {
    throw new ValidationError({ field: "currentPassword" }, "Your current password is incorrect.");
  }

  if (input.currentPassword === input.newPassword) {
    throw new ValidationError(
      { field: "newPassword" },
      "The new password must be different from the current one.",
    );
  }

  const passwordHash = await hashPassword(input.newPassword);

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, passwordChangedAt: new Date(), failedLogins: 0, lockedUntil: null },
  });

  await revokeAllSessions(userId, "password_changed");

  await notify({
    userId,
    type: "SYSTEM",
    title: "Your password was changed",
    body: "Your password was updated and all other sessions were signed out.",
  });

  log.info({ userId, ip: ctx.ipAddress }, "password changed");
}

/** Load the authenticated profile. */
export async function getProfile(userId: string): Promise<AuthenticatedUser> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { elderProfile: { select: { id: true } } },
  });

  if (!user) {
    throw new UnauthorizedError();
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    timeZone: user.timeZone,
    elderId: user.elderProfile?.id ?? null,
  };
}

/** Write an audit trail entry. */
export async function writeAuditLog(entry: {
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        ipAddress: entry.ipAddress?.slice(0, 64) ?? null,
        userAgent: entry.userAgent?.slice(0, 300) ?? null,
        metadata: entry.metadata as never,
      },
    });
  } catch (error) {
    log.error({ err: error, action: entry.action }, "failed to write audit log");
  }
}
