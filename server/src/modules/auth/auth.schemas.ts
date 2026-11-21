import { z } from "zod";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Normalised e-mail address. Lower-cased so that logins are case-insensitive. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(EMAIL_PATTERN, "Enter a valid e-mail address.");

/**
 * Password policy.
 *
 * Length is the dominant factor in password strength, so the minimum is 10
 * characters; the character-class rules keep the password resistant to
 * dictionary attacks without forcing the user into an unrememberable pattern.
 */
export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(200, "Passwords must not exceed 200 characters.")
  .refine((value) => /[a-zA-Z]/.test(value), "Include at least one letter.")
  .refine((value) => /\d/.test(value), "Include at least one number.");

export const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(
    (value) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    },
    { message: "Enter a valid IANA time zone, for example Europe/London." },
  );

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(2, "Enter your name.").max(80),
  phone: z.string().trim().max(32).optional(),
  role: z.enum(["SENIOR", "CAREGIVER"]).default("SENIOR"),
  timeZone: timezoneSchema.default("UTC"),
  /** Health profile — only meaningful for a senior account. */
  elder: z
    .object({
      displayName: z.string().trim().min(2).max(80).optional(),
      dateOfBirth: z.coerce.date().max(new Date(), "Date of birth cannot be in the future.").optional(),
      bloodType: z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "UNKNOWN"]).default("UNKNOWN"),
      conditions: z.array(z.string().trim().min(1).max(80)).max(25).default([]),
    })
    .optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password.").max(200),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
