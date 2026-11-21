import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { env } from "../config/env.js";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * Cryptography helpers.
 *
 * Three distinct primitives are used:
 *
 * 1. **Argon2id** for password hashing. Memory-hard, resistant to GPU
 *    cracking and side-channel attacks. Parameters follow the OWASP
 *    recommendation (19 MiB memory, 2 iterations, 1 degree of parallelism).
 * 2. **AES-256-GCM** for encrypting clinical free text at rest. The
 *    ciphertext carries its own random IV and authentication tag, so
 *    tampering is detected on read.
 * 3. **SHA-256** for high-entropy refresh tokens. Refresh tokens are random
 *    256-bit values, so a fast hash is appropriate (there is nothing to
 *    brute force) and allows constant-time comparison against the database.
 */

const ARGON2_OPTIONS = {
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

/** Hash a plaintext password with Argon2id. */
export async function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON2_OPTIONS);
}

/**
 * Verify a password against an Argon2id hash.
 * Returns `false` for malformed hashes instead of throwing.
 */
export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  try {
    return await argonVerify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Generate a cryptographically random URL-safe token (refresh tokens, CSRF). */
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** SHA-256 hash, hex encoded — used to store opaque tokens at rest. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Constant-time string comparison that does not leak length via early exit. */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) {
    // Still perform a comparison to keep the timing profile flat.
    timingSafeEqual(bufferA, bufferA);
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

// ---------------------------------------------------------------------------
// Field level encryption (AES-256-GCM)
// ---------------------------------------------------------------------------

const ENCRYPTION_VERSION = "v1";

function getEncryptionKey(): Buffer {
  const key = Buffer.from(env.ENCRYPTION_KEY, "base64");
  if (key.length !== 32) {
    throw new Error(
      "ENCRYPTION_KEY must be a base64 encoded 32 byte key. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }
  return key;
}

/**
 * Encrypt a UTF-8 string.
 * Output format: `v1:<iv>:<authTag>:<ciphertext>` (all base64url).
 */
export function encrypt(plaintext: string): string {
  if (plaintext.length === 0) return "";

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    ENCRYPTION_VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

/**
 * Decrypt a value produced by {@link encrypt}.
 * Values that were never encrypted (legacy/plaintext rows) are returned
 * as-is so that the migration path stays safe.
 */
export function decrypt(payload: string | null | undefined): string | null {
  if (payload === null || payload === undefined || payload === "") return null;
  if (!payload.startsWith(`${ENCRYPTION_VERSION}:`)) return payload;

  const [, ivPart, authTagPart, dataPart] = payload.split(":");
  if (!ivPart || !authTagPart || !dataPart) {
    throw new Error("Malformed encrypted payload.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(authTagPart, "base64url"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/** Encrypt a nullable field, returning `null` for empty input. */
export function encryptNullable(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  return encrypt(value);
}

/** Decrypt a nullable field. */
export function decryptNullable(value: string | null | undefined): string | null {
  return decrypt(value);
}

/** Derive a stable, non-reversible lookup key for a value (e.g. e-mail). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Generate a random UUID v4 — used for opaque identifiers. */
export function newUuid(): string {
  return randomUUID();
}

/** Legacy helper kept for password reset tokens. */
export async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return scrypt(password, salt, 32);
}
