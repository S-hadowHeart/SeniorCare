import "dotenv/config";
import { z } from "zod";

/**
 * Centralised, validated runtime configuration.
 *
 * The process refuses to boot when the environment is incomplete or unsafe
 * (e.g. a production deployment that still uses the development JWT secret).
 * Every module imports the typed `env` object instead of touching
 * `process.env` directly, which keeps configuration a single source of truth.
 */

const booleanish = z.preprocess(
  (value) => (value === undefined || value === "" ? "false" : String(value).toLowerCase()),
  z.enum(["true", "false", "1", "0"]).transform((value) => value === "true" || value === "1"),
);

const csv = z.preprocess(
  (value) => (value === undefined || value === null ? "" : String(value)),
  z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default("0.0.0.0"),
  API_PREFIX: z.string().default("/api/v1"),
  WEB_APP_URL: z.string().default("http://localhost:5173"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_DATABASE_URL: z.string().optional(),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),

  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  JWT_ISSUER: z.string().default("seniorcare-api"),
  JWT_AUDIENCE: z.string().default("seniorcare-web"),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).max(128).default(10),
  MAX_FAILED_LOGINS: z.coerce.number().int().min(1).max(100).default(8),
  LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),

  ENCRYPTION_KEY: z
    .string()
    .default("")
    .transform((value) => value.trim())
    .refine(
      (value) => {
        if (!value) return true;
        try {
          return Buffer.from(value, "base64").length === 32;
        } catch {
          return false;
        }
      },
      { message: "ENCRYPTION_KEY must be a base64 encoded 32 byte key" },
    ),

  CORS_ORIGINS: csv.default(["http://localhost:5173", "http://127.0.0.1:5173"]),
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(900_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  SOS_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(20),

  MAIL_ENABLED: booleanish.default(false),
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: booleanish.default(false),
  SMTP_USER: z.string().default(""),
  SMTP_PASSWORD: z.string().default(""),
  MAIL_FROM: z.string().default("SeniorCare <no-reply@seniorcare.app>"),

  JOBS_ENABLED: booleanish.default(true),
  CHECKIN_DEADLINE_HOUR: z.coerce.number().int().min(0).max(23).default(21),
  CHECKIN_MORNING_HOUR: z.coerce.number().int().min(0).max(23).default(9),
  MEDICATION_REMINDER_LEAD_MINUTES: z.coerce.number().int().min(0).max(720).default(15),
  MEDICATION_GRACE_MINUTES: z.coerce.number().int().min(10).max(1440).default(120),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  LOG_PRETTY: booleanish.default(false),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  • ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  // eslint-disable-next-line no-console
  console.error(`\n[seniorcare] Invalid environment configuration:\n${details}\n`);
  process.exit(1);
}

const raw = parsed.data;

if (raw.NODE_ENV === "production") {
  const problems: string[] = [];

  if (raw.JWT_ACCESS_SECRET.startsWith("change-me")) {
    problems.push("JWT_ACCESS_SECRET still uses the placeholder value.");
  }
  if (raw.JWT_ACCESS_SECRET.length < 48) {
    problems.push("JWT_ACCESS_SECRET must be at least 48 characters in production.");
  }
  if (!raw.ENCRYPTION_KEY) {
    problems.push("ENCRYPTION_KEY is required in production.");
  }
  if (raw.CORS_ORIGINS.includes("localhost")) {
    problems.push("CORS_ORIGINS must not point at localhost in production.");
  }
  if (!raw.MAIL_ENABLED) {
    problems.push("MAIL_ENABLED should be true in production so that alerts are delivered.");
  }

  if (problems.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `\n[seniorcare] Refusing to start in production mode:\n${problems
        .map((problem) => `  • ${problem}`)
        .join("\n")}\n`,
    );
    process.exit(1);
  }
}

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === "production",
  isDevelopment: raw.NODE_ENV === "development",
  isTest: raw.NODE_ENV === "test",
} as const;

export type Env = typeof env;
